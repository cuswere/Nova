export const SPREADSHEET_ID = '120ZqG_0qZR76b4kYHdzPK-4OKecjk7MaZcKuQRRLcbI';
export const SHEET_NAME = 'Opportunities';

export const PUBLIC_FIELDS = ['name', 'deadline', 'link', 'type', 'fees', 'country'];
export const WORKFLOW_FIELDS = [
    'id',
    'status',
    'source',
    'source_url',
    'host_location',
    'fee_details',
    'confidence',
    'last_seen',
    'checked_at',
    'issue',
    'description'
];
export const SHEET_HEADERS = [...PUBLIC_FIELDS, ...WORKFLOW_FIELDS];

export const ALLOWED_TYPES = [
    'Grant',
    'Residency',
    'Exhibition',
    'Award',
    'Fellowship',
    'Public Art',
    'Acquisition',
    'Internship',
    'Competition',
    'Open Call',
    'Art Fair',
    'Workshop',
    'Other'
];
export const ALLOWED_STATUSES = ['review', 'publish', 'reject', 'expired'];

export const SOURCE_DEFINITIONS = [
    {
        id: 'artwork_archive',
        name: 'Artwork Archive',
        url: 'https://www.artworkarchive.com/call-for-entry',
        enabled: true,
        limit: 160,
        pages: 8,
        delayMs: 750
    },
    {
        id: 'creative_capital',
        name: 'Creative Capital',
        url: 'https://creative-capital.org/artist-resources/artist-opportunities/',
        enabled: true,
        limit: 24,
        delayMs: 10_000
    },
    {
        id: 'creative_west',
        name: 'Creative West Art Opps',
        url: 'https://opportunities.wearecreativewest.org',
        enabled: true,
        limit: 20
    },
    {
        id: 'hyperallergic',
        name: 'Hyperallergic',
        url: 'https://hyperallergic.com/tag/opportunities/feed/',
        enabled: true,
        limit: 20
    },
    {
        id: 'transartists',
        name: 'TransArtists',
        url: 'https://www.transartists.org/en/transartists-calls',
        enabled: true,
        limit: 12
    }
];

export const USER_AGENT = 'NovaOpportunityBot/1.0 (+https://github.com/wormmanfriend/Nova)';
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
