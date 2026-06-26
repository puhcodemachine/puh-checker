#!/usr/bin/env bash
# Собирает статичную версию панели в docs/ для GitHub Pages.
# Работает без бэкенда: задания через localStorage, проверки/подбор — клиентский JS.
set -e
cd "$(dirname "$0")"
rm -rf docs
mkdir -p docs/static
cp static/bip39.js static/bip39_langs.js static/checker.js static/recover.js static/tasks.js docs/static/
# index.html из шаблона панели: относительные пути к static, подставить пользователя
sed -e 's#src="/static/#src="static/#g' -e 's/{{USER}}/ПУХ/g' templates/panel.html > docs/index.html
touch docs/.nojekyll   # не прогонять через Jekyll
echo "docs/ собран ($(ls docs/static | wc -l) файлов в static)"
