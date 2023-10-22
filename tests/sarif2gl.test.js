const {describe, it} = require ('node:test')
const assert = require ('assert')
const fs = require ('fs')
const sarif2gl = require ('../sarif2gl')

const darn = o => { console.warn(o); return o }

const load_file = p => JSON.parse (darn(fs.readFileSync (darn (p), 'utf8')))

describe('parse', () => {

    it ('should fail on empty input', (t) => {
        assert.throws(() => sarif2gl.parse({}))
    })

    it ('should be ok on ok eslint input', (t) => {
        const inp = load_file('./tests/data/parse.in.eslint.sarif')
        const out = load_file('./tests/data/parse.out.eslint.json')
        assert.deepStrictEqual(sarif2gl.parse (inp), out)
    })
})
