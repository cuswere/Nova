export const SPREADSHEET_ID = '120ZqG_0qZR76b4kYHdzPK-4OKecjk7MaZcKuQRRLcbI';
export const SHEET_NAME = 'Opportunities';

export const PUBLIC_FIELDS = ['name', 'deadline', 'link', 'type', 'fees', 'country', 'award_info'];
// Published extras stay after the leading public-column contract.
export const PUBLISHED_EXTRA_FIELDS = ['fee_details', 'eligibility_details', 'eligibility_tier'];
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
    'description',
    'eligibility_details',
    'eligibility_tier'
];
export const SHEET_HEADERS = [...PUBLIC_FIELDS, ...WORKFLOW_FIELDS];

export const ALLOWED_TYPES = [
    'Grant',
    'Residency',
    'Exhibition',
    'Commission',
    'Award',
    'Fellowship',
    'Acquisition',
    'Internship',
    'Job',
    'Competition',
    'Open Call',
    'Art Fair',
    'Workshop'
];
export const ALLOWED_STATUSES = ['review', 'publish', 'reject', 'expired'];
export const NON_PUBLIC_TYPES = ['Job'];

export const SOURCE_DEFINITIONS = [
    {
        id: 'artwork_archive',
        name: 'Artwork Archive',
        url: 'https://www.artworkarchive.com/call-for-entry',
        enabled: false,
        delayMs: 750,
        autoPublish: true
    },
    {
        id: 'creative_capital',
        name: 'Creative Capital',
        url: 'https://creative-capital.org/artist-resources/artist-opportunities/',
        enabled: true,
        delayMs: 2_000,
        minExpectedResults: 40,
        typeValues: ['commission', 'exhibition', 'fellowship', 'grant', 'job', 'prize', 'residency'],
        autoPublish: true
    },
    {
        id: 'creative_west',
        name: 'Creative West Art Opps',
        url: 'https://opportunities.wearecreativewest.org',
        apiUrl: 'https://opportunities-api.wearecreativewest.org/graphql',
        enabled: true,
        pageSize: 100,
        // Sanity ceiling only; collection stops at the API's live total.
        maxPages: 50,
        autoPublish: true
    },
    {
        id: 'hyperallergic',
        name: 'Hyperallergic',
        url: 'https://hyperallergic.com/tag/opportunities/feed/',
        enabled: true,
        roundupMonths: 3,
        delayMs: 1_000,
        autoPublish: true
    },
    {
        id: 'transartists',
        name: 'TransArtists',
        url: 'https://www.transartists.org/en/transartists-calls',
        enabled: false,
        limit: 12
    }
];

export const USER_AGENT = 'NovaOpportunityBot/1.0 (+https://github.com/cuswere/Nova)';
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
