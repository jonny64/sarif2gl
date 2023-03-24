// fetch: node 18+
const fs = require ('fs')

const {SDL_BOT_TOKEN, CI_SERVER_URL, CI_PROJECT_PATH, CI_COMMIT_SHA, CI_MERGE_REQUEST_DIFF_BASE_SHA, CI_MERGE_REQUEST_IID} = process.env
const sarif_file = process.argv [2]

const gitlab_rq = async  (o) => {
    const headers = {
        'Authorization' : `Bearer ${SDL_BOT_TOKEN}`,
    }

    const project_path = 'projects/' + CI_PROJECT_PATH.split ('/').join ('%2F')

    let url = `${CI_SERVER_URL}/api/v4/`
     + `${project_path}/merge_requests/${CI_MERGE_REQUEST_IID}/discussions`

    let body = new URLSearchParams (o.params)

    console.log ({headers, body, url})

    const rp_raw = await fetch(url, {headers, body, method: 'POST'})
    const rp = await rp_raw.json ()
    const web_url = rp.notes ? (url + '#note_' + rp.notes[0].id) : null

    console.log ({rp, url, web_url})

    return rp
}

const parse = (sarif) => {
    let result = []
    for (let rr of sarif.runs) {
        for (let r of rr.results) {
            let text = r.message.text
            let todo = r.locations.map (loc => {
                let {physicalLocation} = loc
                let {artifactLocation} = physicalLocation
                let src = artifactLocation.uri
                src = src.replace ('/src/', '')
                let line  = physicalLocation.region.endLine
                return {
                    src, line, text
                }
            })
            result = result.concat (todo)
        }
    }
    return result
}

const post2gl = async (todo) => {
    for (let i of todo) {
        let params = {
            'position[new_path]': i.src,
            'position[new_line]': `${i.line}`,
            'position[position_type]': 'text',
            'position[base_sha]': CI_MERGE_REQUEST_DIFF_BASE_SHA,
            'position[head_sha]': CI_COMMIT_SHA,
            'position[start_sha]': CI_MERGE_REQUEST_DIFF_BASE_SHA,
            'body': i.text,
        }
        await gitlab_rq ({params})
    }
}

let sarif = JSON.parse (fs.readFileSync (sarif_file, 'utf8'))
let todo = parse (sarif)
post2gl (todo)
