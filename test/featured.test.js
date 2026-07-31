import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractOpportunities, parseArticleBody, parseFeaturedFeed, safeHref } from '../featured-pipeline/feed.js';
import { mergeArticles, syncFeatured } from '../sync-featured.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');
const feedXml = fixture('praxis-blog-feed.xml');

function feedWith(items) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>${items.join('')}</channel></rss>`;
}

function item({ title = 'Post', slug = 'post', date = 'Wed, 29 Jul 2026 18:28:48 +0000', tags = ['praxisnova'], body = '<p>Body text.</p>', author = 'Brainard Carey' }) {
    return `<item>
        <title>${title}</title>
        <link>https://blog.praxiscenterforaesthetics.com/${slug}/</link>
        <dc:creator><![CDATA[${author}]]></dc:creator>
        <pubDate>${date}</pubDate>
        ${tags.map((tag) => `<category><![CDATA[${tag}]]></category>`).join('')}
        <content:encoded><![CDATA[${body}]]></content:encoded>
    </item>`;
}

test('keeps only items tagged praxisnova', () => {
    const articles = parseFeaturedFeed(feedXml);
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, 'Just Show Up');
    assert.equal(articles[0].slug, 'just-show-up');
    assert.equal(articles[0].link, 'https://blog.praxiscenterforaesthetics.com/just-show-up/');
    assert.equal(articles[0].author, 'Brainard Carey');
    assert.equal(articles[0].date, '2026-07-29T18:28:48.000Z');
});

test('matches the tag regardless of case and ignores the post\'s other categories', () => {
    const articles = parseFeaturedFeed(feedWith([
        item({ slug: 'tagged', tags: ['art', 'PraxisNova', 'summer'] }),
        item({ slug: 'untagged', tags: ['art', 'praxis'] })
    ]));
    assert.deepEqual(articles.map((article) => article.slug), ['tagged']);
});

test('orders newest first and falls back to feed order without a usable date', () => {
    const articles = parseFeaturedFeed(feedWith([
        item({ slug: 'older', date: 'Wed, 15 Jul 2026 12:00:00 +0000' }),
        item({ slug: 'undated', date: 'not a date' }),
        item({ slug: 'newer', date: 'Wed, 22 Jul 2026 12:00:00 +0000' })
    ]));
    assert.deepEqual(articles.map((article) => article.slug), ['newer', 'older', 'undated']);
});

test('decodes entities and carries bold, italic, and links into spans', () => {
    const [article] = parseFeaturedFeed(feedWith([item({
        body: '<p>It&#8217;s <strong>August 15</strong> and <em>We Come in Pieces</em> at <a href="https://headon.org.au/awards" target="_blank">Head On</a>.</p>'
    })]));
    assert.deepEqual(article.blocks, [{
        type: 'p',
        // A link plus a bolded date is the listing shape, so this one is flagged.
        listing: true,
        spans: [
            { text: 'It’s ' },
            { bold: true, text: 'August 15' },
            { text: ' and ' },
            { italic: true, text: 'We Come in Pieces' },
            { text: ' at ' },
            { href: 'https://headon.org.au/awards', text: 'Head On' },
            { text: '.' }
        ]
    }]);
});

test('carries nested formatting on one span and merges runs that match', () => {
    assert.deepEqual(parseArticleBody('<p><a href="https://example.com/x"><strong><em>Apply now</em></strong></a></p>'), [{
        type: 'p',
        listing: true,
        spans: [{ href: 'https://example.com/x', bold: true, italic: true, text: 'Apply now' }]
    }]);
    // A wrapper that carries no formatting must not split the sentence in two.
    assert.deepEqual(parseArticleBody('<p>Some <span class="x">plain</span> text</p>'), [{
        type: 'p',
        spans: [{ text: 'Some plain text' }]
    }]);
});

test('drops links that are not plain web traffic but keeps their text', () => {
    const blocks = parseArticleBody('<p>Careful <a href="javascript:alert(1)">here</a> and <a href="/relative/page/">there</a>.</p>');
    assert.deepEqual(blocks, [{
        type: 'p',
        spans: [
            { text: 'Careful here and ' },
            { href: 'https://blog.praxiscenterforaesthetics.com/relative/page/', text: 'there' },
            { text: '.' }
        ]
    }]);
    assert.equal(safeHref('javascript:alert(1)'), '');
    assert.equal(safeHref('data:text/html,x'), '');
    assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
});

test('maps headings, lists, rules, and images, and degrades unknown blocks to paragraphs', () => {
    const blocks = parseArticleBody(`
        <h2>Deadlines</h2>
        <h4>Soon</h4>
        <ul><li>First <em>one</em></li><li>Second</li></ul>
        <hr />
        <figure><img src="https://i0.wp.com/blog.praxiscenterforaesthetics.com/x.png" alt="A screenshot" /><figcaption>The award page.</figcaption></figure>
        <section>Loose text.</section>
    `);
    assert.deepEqual(blocks, [
        { type: 'h2', spans: [{ text: 'Deadlines' }] },
        { type: 'h3', spans: [{ text: 'Soon' }] },
        { type: 'ul', items: [[{ text: 'First ' }, { italic: true, text: 'one' }], [{ text: 'Second' }]] },
        { type: 'hr' },
        { type: 'img', src: 'https://i0.wp.com/blog.praxiscenterforaesthetics.com/x.png', alt: 'A screenshot' },
        { type: 'p', spans: [{ text: 'The award page.' }] },
        { type: 'p', spans: [{ text: 'Loose text.' }] }
    ]);
});

test('lists the opportunities a real post carries, and nothing else in it', () => {
    const [article] = parseFeaturedFeed(feedXml);
    assert.deepEqual(article.opportunities, [
        { title: 'The Blu Sky Artist Award', deadline: 'August 15' },
        { title: 'Head On Photo Awards', deadline: 'August 16' },
        { title: 'Prospect Art', deadline: 'August 16' }
    ]);
});

test('takes the first link as the name and skips paragraphs missing a link or a deadline', () => {
    const blocks = parseArticleBody(`
        <p>Opening prose with a <a href="https://example.com/none">link</a> and no deadline.</p>
        <p><a href="https://example.com/a">Award A</a> pays <strong>$500</strong>, more at <a href="https://example.com/a2">the website</a>. Deadline is <strong>August 15</strong>.</p>
        <p>A deadline of <strong>August 16</strong> with no link at all.</p>
    `);
    assert.deepEqual(extractOpportunities(blocks), [{ title: 'Award A', deadline: '$500' }]);
});

test('caps the roster and strips punctuation pulled into the bold run', () => {
    const blocks = parseArticleBody(
        ['A', 'B', 'C', 'D']
            .map((name) => `<p><a href="https://example.com/${name}">Award ${name}</a>. Deadline is <strong>August 15.</strong></p>`)
            .join('')
    );
    assert.deepEqual(extractOpportunities(blocks), [
        { title: 'Award A', deadline: 'August 15' },
        { title: 'Award B', deadline: 'August 15' },
        { title: 'Award C', deadline: 'August 15' }
    ]);
    assert.equal(extractOpportunities(blocks, { limit: 1 }).length, 1);
});

test('flags listing paragraphs, and flags exactly the ones the roster is built from', () => {
    const blocks = parseArticleBody(`
        <p>Opening prose with a <a href="https://example.com/none">link</a> and no deadline.</p>
        <p><a href="https://example.com/a">Award A</a>. Deadline is <strong>August 15</strong>.</p>
        <p>Closing prose with a <strong>bolded</strong> word and no link.</p>
    `);
    assert.deepEqual(blocks.map((block) => Boolean(block.listing)), [false, true, false]);

    // The article's outlines and the home page's roster must never disagree.
    const [article] = parseFeaturedFeed(feedXml);
    assert.deepEqual(
        article.blocks.filter((block) => block.listing).map((block) => block.spans.find((span) => span.href).text),
        article.opportunities.map((opportunity) => opportunity.title)
    );
    assert.equal(article.opportunities.length, 3);
});

test('drops the sign-off photo credit, which refers to an image the body never carries', () => {
    assert.deepEqual(parseArticleBody('<p>Body.</p><p><em>Photo credit: Blu Sky Artist Award</em></p>'), [
        { type: 'p', spans: [{ text: 'Body.' }] }
    ]);
    assert.deepEqual(parseArticleBody('<p>Image Credit — Someone</p>'), []);
    // Only a credit line: prose that merely mentions a photo has to survive.
    assert.equal(parseArticleBody('<p>Photo credits are handled by the gallery.</p>').length, 1);
    assert.equal(parseArticleBody('<p>Send a photo credit to the editor.</p>').length, 1);

    const [article] = parseFeaturedFeed(feedXml);
    assert.ok(!JSON.stringify(article.blocks).toLowerCase().includes('photo credit'));
});

test('an article with no listings gets an empty roster rather than failing', () => {
    const [article] = parseFeaturedFeed(feedWith([item({ body: '<p>Just an essay, no opportunities.</p>' })]));
    assert.deepEqual(article.opportunities, []);
});

test('skips items with no body, no link, or no title', () => {
    const articles = parseFeaturedFeed(feedWith([
        item({ slug: 'empty', body: '' }),
        item({ slug: 'fine' }),
        `<item><link>https://blog.praxiscenterforaesthetics.com/no-title/</link><category><![CDATA[praxisnova]]></category><content:encoded><![CDATA[<p>x</p>]]></content:encoded></item>`
    ]));
    assert.deepEqual(articles.map((article) => article.slug), ['fine']);
});

test('merge keeps articles the feed has aged out and lets the feed win on a reissue', () => {
    const existing = [
        { slug: 'old', title: 'Old', date: '2026-07-01T00:00:00.000Z' },
        { slug: 'current', title: 'Stale title', date: '2026-07-22T00:00:00.000Z' }
    ];
    const incoming = [
        { slug: 'fresh', title: 'Fresh', date: '2026-07-29T00:00:00.000Z' },
        { slug: 'current', title: 'Edited title', date: '2026-07-22T00:00:00.000Z' }
    ];
    assert.deepEqual(mergeArticles(existing, incoming).map((article) => [article.slug, article.title]), [
        ['fresh', 'Fresh'],
        ['current', 'Edited title'],
        ['old', 'Old']
    ]);
});

test('merge caps the archive at the newest entries', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
        slug: `post-${index}`,
        date: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
    }));
    const merged = mergeArticles([], many, { limit: 12 });
    assert.equal(merged.length, 12);
    assert.equal(merged[0].slug, 'post-19');
});

test('sync writes pretty-printed JSON and keeps the roster when the feed has nothing tagged', async () => {
    const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'featured-')), 'featured.json');
    await syncFeatured({ destination, fetcher: async () => ({ text: feedXml }) });

    const written = fs.readFileSync(destination, 'utf8');
    assert.ok(written.endsWith('\n'));
    assert.equal(JSON.parse(written).length, 1);
    assert.ok(written.includes('\n  {\n    "slug": "just-show-up"'));

    const untagged = feedWith([item({ slug: 'other', tags: ['art'] })]);
    const { merged } = await syncFeatured({ destination, fetcher: async () => ({ text: untagged }) });
    assert.deepEqual(merged.map((article) => article.slug), ['just-show-up']);
});
