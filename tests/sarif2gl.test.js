const {describe, it} = require ('node:test')
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
})


describe('filter_findings', async () => {

    it ('should load MR diff', async (t) => {
        const inp_rp = load_file('./tests/data/rp.gitlab.merge_requests.42.changes.json')

        const inp = await sarif2gl.parse_diff (inp_rp)
        const out = load_file('./tests/data/rp.gitlab.merge_requests.42.changes.parsed.json')

        assert.deepStrictEqual(inp, out)
    })

})