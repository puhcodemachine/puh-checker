#!/usr/bin/env bash
# Один шаг разработки: пересобрать витрину -> закоммитить -> запушить.
# Pages обновится сам через ~1 мин. Использование: ./deploy.sh "что сделал"
set -e
cd "$(dirname "$0")"
MSG="${1:-обновление панели}"
./build_pages.sh
git add -A
if git diff --cached --quiet; then echo "нет изменений — деплоить нечего"; exit 0; fi
TOKEN="$(cat /root/PUH/.gh_token | tr -d '\n ')"
git -c user.name="puhcodemachine" -c user.email="puh@local" commit -q -m "$MSG

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push "https://x-access-token:${TOKEN}@github.com/puhcodemachine/puh-checker.git" main 2>&1 | sed "s/${TOKEN}/***/g" | tail -1
echo "→ витрина обновится через ~1 мин: https://puhcodemachine.github.io/puh-checker/"
