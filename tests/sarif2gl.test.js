const {describe, it, mock} = require ('node:test')
const assert = require ('assert')
const fs = require ('fs')
const sarif2gl = require ('../sarif2gl')

const darn = o => { console.warn(o); return o }

const load_file = p => JSON.parse (fs.readFileSync (p, 'utf8'))

describe('parse', () => {

    it ('should fail on empty input', (t) => {
        assert.throws(() => sarif2gl.parse({}))
    })

    it ('should be ok on ok eslint input', (t) => {
        const inp = load_file('./tests/data/parse.in.eslint.sarif')
        const out = load_file('./tests/data/parse.out.eslint.json')
        assert.deepStrictEqual(sarif2gl.parse (inp), out)
    })

    it ('should print tool parse error', (t) => {
        const inp = load_file('./tests/data/parse.in.eslint.parse-error.sarif')
        const out = load_file('./tests/data/parse.out.eslint.parse-error.json')
        assert.deepStrictEqual(sarif2gl.parse (inp), out)
    })

    it ('should print tool notification without endLine', (t) => {
        const inp = load_file('./tests/data/parse.in.eslint.ESL0999.sarif')
        const out = load_file('./tests/data/parse.out.eslint.ESL0999.json')
        assert.deepStrictEqual(sarif2gl.parse (inp), out)
    })

    it ('should parse codeFlows from semgrep', (t) => {
        const inp = load_file('./tests/data/parse.in.semgrep.codeflows.sarif')
        const out = load_file('./tests/data/parse.out.semgrep.codeflows.json')
        assert.deepStrictEqual(sarif2gl.parse(inp), out)
    })
})


describe('filter findings', async () => {

    it ('should skip deleted files', async (t) => {
        const inp_rp = load_file('./tests/data/rp.gitlab.merge_requests.42.changes.json')

        const inp = await sarif2gl.parse_diff (inp_rp)
        const out = load_file('./tests/data/rp.gitlab.merge_requests.42.changes.parsed.json')

        assert.deepStrictEqual(inp, out)
    })

})


describe('markdown', () => {

    it ('should handle markdown items in todo', (t) => {
        process.env.CI_PIPELINE_URL = 'https://gitlab.company/test/test/pipelines/1'
        const todo = [
            {type: 'md', label: '# Test Report'}
        ]
        const result = sarif2gl.to_note (todo)
        assert.ok(result.includes('# Test Report'))
        assert.ok(result.includes('reported by'))
    })

    it ('should return OK for empty todo', (t) => {
        const result = sarif2gl.to_note ([])
        assert.strictEqual(result, 'OK')
    })
})


describe('api', async () => {

    const env = {
        SDL_BOT_TOKEN: 'test-token',
        CI_MERGE_REQUEST_IID: 42,
        CI_SERVER_URL: 'https://gitlab.company',
        CI_PROJECT_PATH: 'test/test'
    }

    it ('should throw on missing env var', async () => {
        const {SDL_BOT_TOKEN, ...env_no_token} = env
        await assert.rejects(
            sarif2gl.main({env: env_no_token}),
            {message: /missing required env vars:.*SDL_BOT_TOKEN/}
        )
    })

    it ('should throw on invalid discussions response', async () => {
        global.fetch = mock.fn(() => Promise.resolve({
            json: () => Promise.resolve({message: '401 Unauthorized'})
        }))
        sarif2gl.to_note = mock.fn(() => 'sarif2gl note text')

        await assert.rejects(
            sarif2gl.main({env}),
            {message: /gitlab api error:.*401 Unauthorized/}
        )
    })

    it ('should create new note if none exists', async () => {

        global.fetch = mock.fn((o) => {
            let rp = {}
            if (o.includes ('discussions')) {
                rp = []
            }
            console.log ([o, rp])
            return Promise.resolve({
                json: () => Promise.resolve(rp),
            })
        })
    
        sarif2gl.to_note = mock.fn(o => 'sarif2gl note text')

        const out = await sarif2gl.main ({env})

        const calls = global.fetch.mock.calls
        assert.strictEqual(calls.length, 2)
        assert.strictEqual(calls[0].arguments[0], `${env.CI_SERVER_URL}/api/v4/projects/test%2Ftest/merge_requests/${env.CI_MERGE_REQUEST_IID}/discussions?per_page=1000`)
        assert.strictEqual(calls[0].arguments[1].method, 'GET')
        assert.strictEqual(calls[1].arguments[0], `${env.CI_SERVER_URL}/api/v4/projects/test%2Ftest/merge_requests/${env.CI_MERGE_REQUEST_IID}/discussions`)
        assert.strictEqual(calls[1].arguments[1].method, 'POST')

    })

    it ('should edit existing note', async () => {

        global.fetch = mock.fn((o) => {
            let rp = {}
            if (o.includes ('discussions')) {
                rp = [{
                    id: 42,
                    notes: [{id:4242, body: `reported by sarif2gl`}]
                }]
            }
            console.log ([o, rp])
            return Promise.resolve({
                json: () => Promise.resolve(rp),
            })
        })
    
        sarif2gl.to_note = mock.fn(o => 'sarif2gl note text')

        const out = await sarif2gl.main ({env})

        const calls = global.fetch.mock.calls
        assert.strictEqual(calls.length, 3)
        assert.strictEqual(calls[0].arguments[0], `${env.CI_SERVER_URL}/api/v4/projects/test%2Ftest/merge_requests/${env.CI_MERGE_REQUEST_IID}/discussions?per_page=1000`)
        assert.strictEqual(calls[0].arguments[1].method, 'GET')
        assert.strictEqual(calls[1].arguments[0], `${env.CI_SERVER_URL}/api/v4/projects/test%2Ftest/merge_requests/${env.CI_MERGE_REQUEST_IID}/discussions/42/notes/4242`)
        assert.strictEqual(calls[1].arguments[1].method, 'PUT') // edit note
        assert.strictEqual(calls[2].arguments[0], `${env.CI_SERVER_URL}/api/v4/projects/test%2Ftest/merge_requests/${env.CI_MERGE_REQUEST_IID}/discussions/42/notes/4242`)
        assert.strictEqual(calls[2].arguments[1].method, 'PUT') // resolve note

    })
})
