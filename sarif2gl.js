#! /usr/bin/env node

const fs = require ('fs')

const {SDL_BOT_TOKEN, CI_SERVER_URL, CI_PROJECT_DIR, CI_PROJECT_PATH, CI_COMMIT_SHA, CI_MERGE_REQUEST_PROJECT_URL, CI_MERGE_REQUEST_IID, CI_PIPELINE_URL} = process.env
const [_, __, ...sarif_files] = process.argv
const SARIF2GL_NOTE_SIGN = 'sarif2gl'

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

    let fix_src = (src) => {
        src = src.replace (`file://`, '')
        src = src.replace (CI_PROJECT_DIR, '')
        src = src.replace (/^\/src\//, '')
        src = src.replace (/^\/.build\//, '')
        src = src.replace (/^\/builds\//, '')
        return src
    }

    for (let rr of sarif.runs) {

        let idx = {}

        let driver = rr.tool.driver

        for (let i of driver.rules || []) {
            idx [i.id] = i
        }

        for (let r of rr.results) {
            if (r.suppressions) continue
            let text = r.message.text
            let todo = r.locations.map (loc => {
                let {physicalLocation} = loc
                let {artifactLocation} = physicalLocation
                let src = fix_src (artifactLocation.uri)
                let line = physicalLocation.region.endLine || physicalLocation.region.startLine
                let rule_id = r.ruleId
                let rule = idx [rule_id]
                let rule_help_uri = rule.helpUri || ''
                let rule_help_text = ''
                if (rule.help && rule.help.text) {
                    rule_help_text = rule.help.text
                    rule_help_text = rule_help_text.split ("\n").join ("<br />")
                }
                return {
                    rule_id,
                    src,
                    line,
                    rule_help_uri,
                    rule_help_text,
                    text,
                }
            })
            result = result.concat (todo)
        }

        for (let i of rr.invocations || []) {
            for (let n of i.toolExecutionNotifications || []) {
                result.push ({
                    rule_id: '',
                    src: '',
                    line: '',
                    rule_help_uri: '',
                    text: n.message.text,
                })
            }
            for (let n of i.toolConfigurationNotifications || []) {
                let text = n.message.text

                let todo = (n.locations || []).map (loc => {
                    let {physicalLocation} = loc
                    let {artifactLocation} = physicalLocation
                    let src = fix_src (artifactLocation.uri)
                    let line = physicalLocation.region.endLine || physicalLocation.region.startLine
                    return {
                        rule_id: '',
                        src,
                        line,
                        rule_help_uri: '',
                        text,
                    }
                })
                result = result.concat (todo)
            }
        }
    }

    return result
}

const parse_diff = async (rp) => {

    let seen = {}

    for (let i of rp.changes || []) {
        if (i.deleted_file || !i.new_path) continue
        seen [i.new_path] = 1
    }

    console.log (`seen = ${JSON.stringify(seen)}`)

    return seen
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

const main = async () => {

    let todo = []

    for (let f of sarif_files) {

        let s = JSON.parse (fs.readFileSync (f, 'utf8'))

        let t = parse (s)

        todo = todo.concat (t)

    }


    let url_diff = `merge_requests/${CI_MERGE_REQUEST_IID}/changes`

    let diffs = await gitlab_rq ({body: '', url: url_diff, method: 'GET'})

    let seen = await parse_diff (diffs)
    
    console.log (`todo = ${JSON.stringify(todo)}`)

    todo = todo.filter (t => seen [t.src])


    let note = to_note (todo)

    console.log (`note: ${note}`)


    let url = `merge_requests/${CI_MERGE_REQUEST_IID}/discussions`

    let discussions = await gitlab_rq ({body: '', url, method: 'GET'})

    let d = find_note (discussions, SARIF2GL_NOTE_SIGN)

    if (!d.note) { // create

        if (note == 'OK') return

        let body = {
            body: note
        }

        console.log (`no note found, creating new...`)

        return gitlab_rq ({body, url})
    }

    if (d.note.resolved && note == 'OK') return

    let url_edit = `${url}/${d.discussion.id}/notes/${d.note.id}`

    if (note != 'OK') {
        console.log (`editing note...`)
        await gitlab_rq ({body: {body: note}, url: url_edit, method: 'PUT'})
    }

    let resolved = note == 'OK'? 'true' : 'false'

    return gitlab_rq ({body: {resolved}, url: url_edit, method: 'PUT'})
}

const to_note = (todo) => {

    if (!todo.length) return 'OK'

    let lines = [
        `| src | rule | desc |`,
        `| --- | ---  | ---  |`,
    ]

    for (let i of todo) {

        let rule_help_markdown = [
            !i.rule_help_uri? i.rule_id : `[${i.rule_id}](${i.rule_help_uri})`,
            i.rule_help_text
        ].filter (i => !!i).join ("<br/>")

        let line = [
            {
                label: `[${i.src}#L${i.line}](${CI_MERGE_REQUEST_PROJECT_URL}/-/blob/${CI_COMMIT_SHA}/${i.src}#L${i.line})`,
                off: !i.src
            },
            {
                label: rule_help_markdown,
                off: !i.rule_id
            },
            {
                label: i.text.split ("\n").join ("<br>"),
            },
        ].map (i => i.off? '?' : i.label).join (' | ')

        lines.push (`| ${line} |`)
    }

    lines.push ("\n\n")
    lines.push (`reported by [${SARIF2GL_NOTE_SIGN}](${CI_PIPELINE_URL})  \n`)

    return lines.join ("\n")
}

module.exports = {
    parse,
    parse_diff,
}

if (!CI_MERGE_REQUEST_IID) {
    if (!process.env.NODE_TEST_CONTEXT) {
        console.log (`no CI_MERGE_REQUEST_IID env, exiting...`)
    }
    return
}

main ()
