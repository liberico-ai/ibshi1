#!/bin/bash
# =============================================================
# IBS-ERP Deploy Script
# Tự động: commit → push code lên git → migrate database remote
# =============================================================
# Usage:
#   ./scripts/deploy.sh "commit message"
#   npm run deploy -- "commit message"
# =============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check commit message
COMMIT_MSG="${1:-auto: update $(date '+%Y-%m-%d %H:%M')}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  IBS-ERP Deploy Script${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ── Step 1: Check for changes ──
echo -e "\n${YELLOW}[1/4] Kiểm tra thay đổi...${NC}"
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo -e "${GREEN}  ✓ Không có thay đổi code mới${NC}"
  SKIP_GIT=true
else
  SKIP_GIT=false
  echo -e "  Có thay đổi cần commit"
  git status --short
fi

# ── Step 2: Prisma generate ──
echo -e "\n${YELLOW}[2/4] Generate Prisma Client...${NC}"
npx prisma generate 2>/dev/null && echo -e "${GREEN}  ✓ Prisma Client đã generate${NC}"

# ── Step 3: Push migration lên database remote ──
echo -e "\n${YELLOW}[3/4] Deploy migrations lên database remote...${NC}"
echo -e "  Database: 103.141.177.194:15432/ibshi"

# Dùng prisma migrate deploy (production-safe, không tạo migration mới)
npx prisma migrate deploy 2>&1 | while IFS= read -r line; do
  echo "  $line"
done

if [ $? -eq 0 ]; then
  echo -e "${GREEN}  ✓ Database migration thành công${NC}"
else
  echo -e "${RED}  ✗ Migration thất bại! Kiểm tra lại kết nối database${NC}"
  exit 1
fi

# ── Step 4: Git commit & push ──
echo -e "\n${YELLOW}[4/4] Git commit & push...${NC}"
if [ "$SKIP_GIT" = true ]; then
  echo -e "${GREEN}  ✓ Không có thay đổi để push${NC}"
else
  git add -A
  git commit -m "$COMMIT_MSG"
  git push origin "$(git branch --show-current)"
  echo -e "${GREEN}  ✓ Đã push lên origin/$(git branch --show-current)${NC}"
fi

echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅ Deploy hoàn tất!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
