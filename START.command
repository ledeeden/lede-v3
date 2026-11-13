#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null; then
  echo '未找到 Node.js。请安装 Node.js 22.16 或以上，再打开 START.command。'
  read '?按回车结束…'
  exit 1
fi
node scripts/launch.mjs "$@"
if [[ $? -ne 0 ]]; then read '?启动未成功。请阅读上方信息，按回车结束…'; fi
