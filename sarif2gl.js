#! /usr/bin/env node

const fs = require ('fs')

const {SDL_BOT_TOKEN
    , CI_SERVER_URL
    , CI_PROJECT_DIR
    , CI_PROJECT_PATH
    , CI_COMMIT_SHA
    , CI_MERGE_REQUEST_PROJECT_URL
    , CI_MERGE_REQUEST_IID
    , CI_PIPELINE_URL
    , SARIF2GL_SKIP_UNCHANGED
    , SARIF2GL_REMOVE_URI_PART
} = process.env
const [_, __, ...files] = process.argv
const SARIF2GL_NOTE_SIGN = 'sarif2gl'

const gitlab_rq = async  (o) => {
    const {env} = o
    const headers = {
        'Authorization' : `Bearer ${env.SDL_BOT_TOKEN}`,
        'Content-Type' : 'application/json'
    }

    const project_path = 'projects/' + env.CI_PROJECT_PATH.split ('/').join ('%2F')

    let url = `${env.CI_SERVER_URL}/api/v4/${project_path}/${o.url}`

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
        src = src.replace (SARIF2GL_REMOVE_URI_PART, '')
        src = src.replace (/^\/.build\//, '')
        src = src.replace (/^\/builds\//, '')
        src = src.replace (/^\//, '')
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
                    let line = physicalLocation?.region?.endLine || physicalLocation?.region?.startLine || 1
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

const main = async (o) => {

    const {env} = o

    const required_env = ['SDL_BOT_TOKEN', 'CI_SERVER_URL', 'CI_PROJECT_PATH']
    const missing_env = required_env.filter(v => !env[v])
    if (missing_env.length) {
        throw new Error(`missing required env vars: ${missing_env.join(', ')}`)
    }

    let md_files = files.filter (f => f.endsWith ('.md'))
    let sarif_files = files.filter (f => !f.endsWith ('.md'))

    let todo = []

    for (let f of sarif_files) {

        let s = JSON.parse (fs.readFileSync (f, 'utf8'))

        let t = parse (s)

        todo = todo.concat (t)

    }

    for (let f of md_files) {
        let md = fs.readFileSync (f, 'utf8')
        todo.push ({type: 'md', label: md})
    }

    if (SARIF2GL_SKIP_UNCHANGED) {
        let url_diff = `merge_requests/${env.CI_MERGE_REQUEST_IID}/changes`

        let diffs = await gitlab_rq ({body: '', url: url_diff, method: 'GET', ...o})

        let seen = await parse_diff (diffs)

        console.log (`todo = ${JSON.stringify(todo)}`)

        todo = todo.filter (t => seen [t.src])
    }


    let note = module.exports.to_note (todo)

    console.log (`note: ${note}`)
    if (!env) {
        console.log (`no env, exiting...`)
        return
    }

    let url = `merge_requests/${env.CI_MERGE_REQUEST_IID}/discussions`

    let discussions = await gitlab_rq ({body: '', url: url + '?per_page=1000', method: 'GET', ...o})

    if (!Array.isArray(discussions)) {
        throw new Error(`gitlab api error: ${JSON.stringify(discussions)}`)
    }

    let d = find_note (discussions, SARIF2GL_NOTE_SIGN)

    if (!d.note) { // create

        if (note == 'OK') return

        let body = {
            body: note
        }

        console.log (`no note found, creating new...`)

        return gitlab_rq ({body, url, ...o})
    }

    if (d.note.resolved && note == 'OK') return

    let url_edit = `${url}/${d.discussion.id}/notes/${d.note.id}`

    if (note != 'OK') {
        console.log (`editing note...`)
        await gitlab_rq ({body: {body: note}, url: url_edit, method: 'PUT', ...o})
    }

    let resolved = note == 'OK'? 'true' : 'false'

    return gitlab_rq ({body: {resolved}, url: url_edit, method: 'PUT', ...o})
}

const to_md = (findings) => {

    if (!findings.length) return ''

    let lines = [
        `| src | rule | desc |`,
        `| --- | ---  | ---  |`,
    ]

    let fix_markdown = s => s.split ("\n").join ("<br/>").split ("\\n").join ("<br/>")

    for (let i of findings) {

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
                label: fix_markdown (rule_help_markdown),
                off: !i.rule_id
            },
            {
                label: fix_markdown (i.text),
            },
        ].map (i => i.off? '?' : i.label).join (' | ')

        lines.push (`| ${line} |`)
    }

    return lines.join ("\n")
}

const to_note = (todo) => {

    if (!todo.length) return 'OK'

    let findings = todo.filter (i => i.type != 'md')
    let md = todo.filter (i => i.type == 'md').map (i => i.label).join ("\n\n")

    let lines = []

    let sarif_table = to_md (findings)
    if (sarif_table) {
        lines.push (sarif_table)
        lines.push ("\n\n")
    }

    if (md) {
        lines.push (md)
        lines.push ("\n\n")
    }

    lines.push (`reported by [${SARIF2GL_NOTE_SIGN}](${CI_PIPELINE_URL})  \n`)

    return lines.join ("\n")
}

module.exports = {
    parse,
    parse_diff,
    to_md,
    to_note,
    main,
}

if (CI_MERGE_REQUEST_IID || !process.env.NODE_TEST_CONTEXT) {
    (async () => {
        try {
            await main({env: process.env})
        } catch (e) {
            console.log(e.message)
            process.exitCode = 1
        }
    })()
}
