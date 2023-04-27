export SDL_BOT_TOKEN=
export CI_MERGE_REQUEST_IID=42
export CI_SERVER_URL="https://some.company.org"
export CI_MERGE_REQUEST_PROJECT_URL="https://some.company.org/namespace/project"
export CI_PROJECT_DIR="/builds/namespace/project"
export CI_PROJECT_PATH="namespace/project"
export CI_COMMIT_SHA=
export CI_MERGE_REQUEST_DIFF_BASE_SHA=
export CI_PIPELINE_URL="https://some.company.org/namespace/project/-/pipelines/4242"
node sarif2gl.js semgrep.sarif
sha512sum --tag sarif2gl.js