// fetch: node 18+
const fs = require ('fs')

const {SDL_BOT_TOKEN, CI_SERVER_URL, CI_PROJECT_PATH, CI_COMMIT_SHA, CI_MERGE_REQUEST_PROJECT_URL, CI_MERGE_REQUEST_IID, CI_PIPELINE_URL} = process.env
const sarif_file = process.argv [2]

const gitlab_rq = async  (o) => {
    const headers = {
        'Authorization' : `Bearer ${SDL_BOT_TOKEN}`,
        'Content-Type' : 'application/json'
    }

    const project_path = 'projects/' + CI_PROJECT_PATH.split ('/').join ('%2F')

    let url = `${CI_SERVER_URL}/api/v4/${project_path}/${o.url}`

    const options = {headers, method: o.method || 'POST'}

    if (['POST', 'PUT'].includes (options.method)) {
        options.body = JSON.stringify (o.body)
    }

    console.log ({options})

    const rp_raw = await fetch(url, options)
    const rp = await rp_raw.json ()
    const web_url = rp.notes ? (url + '#note_' + rp.notes[0].id) : null

    console.log ({rp, url, web_url})

    return rp
}

const parse = (sarif) => {
    let result = []
    for (let rr of sarif.runs) {

        let idx = {}

        for (let i of rr.tool.driver.rules || []) {
            idx [i.id] = i
        }

        for (let r of rr.results) {
            if (r.suppressions) continue
            let text = r.message.text
            let todo = r.locations.map (loc => {
                let {physicalLocation} = loc
                let {artifactLocation} = physicalLocation
                let src = artifactLocation.uri
                src = src.replace ('/src/', '')
                let line  = physicalLocation.region.endLine
                let rule_id = r.ruleId
                let rule_help_ui = idx [rule_id].helpUri
                return {
                    rule_id, src, line, rule_help_ui, text
                }
            })
            result = result.concat (todo)
        }
    }
    return result
}

const find_note = (discussions, sign) => {

    for (let discussion of discussions || []) {

        if (discussion.individual_note) continue

        for (let note of discussion.notes || []) {
            if (note.body && note.body.includes (sign)) {
                return {discussion, note}
            }
        }
    }

    return {}
}

const post2gl = async (note) => {

    let url = `merge_requests/${CI_MERGE_REQUEST_IID}/discussions`

    let discussions = await gitlab_rq ({body: '', url, method: 'GET'})

    let d = find_note (discussions, sarif_file)

    if (!d.note) { // create

        if (note == 'OK') return

        let body = {
            body: note
        }

        console.log (`no note found, creating new...`)

        return gitlab_rq ({body, url})
    }

    let url_edit = `${url}/${d.discussion.id}/notes/${d.note.id}`

    let body = note == 'OK'? {resolved: 'true'} : {body: note}

    console.log (`note found, editing...`)

    return gitlab_rq ({body, url: url_edit, method: 'PUT'})
}

const to_note = (todo) => {

    if (!todo.length) return 'OK'

    let lines = [
        `[${sarif_file}](${CI_PIPELINE_URL})  \n`,
        `| src | rule | desc |`,
        `| --- | ---  | ---  |`,
    ]
    
    for (let i of todo) {
        let line = `| `
            + `[${i.src}#L${i.line}](${CI_MERGE_REQUEST_PROJECT_URL}/-/blob/${CI_COMMIT_SHA}/${i.src}#L${i.line})`
            + ` | [${i.rule_id}](${i.rule_help_ui})`
            + ` | ${i.text}`
            + ` |`
        lines.push (line)
    }

    return lines.join ("\n")
}

let sarif = JSON.parse (fs.readFileSync (sarif_file, 'utf8'))
let todo = parse (sarif)
let note = to_note (todo)
post2gl (note)
