#!/bin/bash
# Fly.io Deployment Script for EligibilityAgent
# Run from the repository root

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== EligibilityAgent Fly.io Deployment ===${NC}"

# Check if fly CLI is installed
if ! command -v fly &> /dev/null; then
    echo -e "${RED}Error: flyctl is not installed${NC}"
    echo "Install with: brew install flyctl"
    echo "Or: curl -L https://fly.io/install.sh | sh"
    exit 1
fi

# Check if logged in
if ! fly auth whoami &> /dev/null; then
    echo -e "${YELLOW}Not logged in to Fly.io${NC}"
    fly auth login
fi

# Configuration - update these values
API_APP_NAME="eligibility-api"
WEB_APP_NAME="eligibility-web"
DB_NAME="eligibility-db"
REGION="iad"

# Your custom domain (optional)
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}"

echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  API App: $API_APP_NAME"
echo "  Web App: $WEB_APP_NAME"
echo "  Database: $DB_NAME"
echo "  Region: $REGION"
echo ""

# Step 1: Create apps if they don't exist
echo -e "${GREEN}Step 1: Creating apps...${NC}"

if ! fly apps list | grep -q "$API_APP_NAME"; then
    fly apps create "$API_APP_NAME" --org personal || true
else
    echo "  API app already exists"
fi

if ! fly apps list | grep -q "$WEB_APP_NAME"; then
    fly apps create "$WEB_APP_NAME" --org personal || true
else
    echo "  Web app already exists"
fi

# Step 2: Create database if it doesn't exist
echo ""
echo -e "${GREEN}Step 2: Creating database...${NC}"

if ! fly postgres list | grep -q "$DB_NAME"; then
    fly postgres create \
        --name "$DB_NAME" \
        --region "$REGION" \
        --vm-size shared-cpu-1x \
        --initial-cluster-size 1 \
        --volume-size 1

    # Attach database to API app
    fly postgres attach "$DB_NAME" --app "$API_APP_NAME"
else
    echo "  Database already exists"
fi

# Step 3: Set secrets (you'll need to set these manually first time)
echo ""
echo -e "${GREEN}Step 3: Checking secrets...${NC}"
echo -e "${YELLOW}Make sure you have set the following secrets for $API_APP_NAME:${NC}"
echo "  - ANTHROPIC_API_KEY"
echo "  - STEDI_API_KEY"
echo "  - PF_CLIENT_ID"
echo "  - PF_CLIENT_SECRET"
echo "  - PF_SCOPES"
echo "  - ENCRYPTION_KEY"
echo ""
echo "Run this command to set them:"
echo ""
cat << 'EOF'
fly secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  STEDI_API_KEY="..." \
  PF_CLIENT_ID="..." \
  PF_CLIENT_SECRET="..." \
  PF_SCOPES="launch openid fhirUser offline_access patient/Patient.read patient/Coverage.read user/Practitioner.read patient/Organization.read" \
  STEDI_API_URL="https://healthcare.us.stedi.com/2024-04-01" \
  ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --app eligibility-api
EOF
echo ""

read -p "Have you set the API secrets? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Please set secrets first, then re-run this script${NC}"
    exit 1
fi

# Step 4: Deploy API
echo ""
echo -e "${GREEN}Step 4: Deploying API...${NC}"
cd apps/api
fly deploy --app "$API_APP_NAME"
cd ../..

# Wait for API to be healthy
echo "Waiting for API to be healthy..."
sleep 10

# Step 5: Set Web secrets and deploy
echo ""
echo -e "${GREEN}Step 5: Setting web secrets and deploying...${NC}"

API_URL="https://${API_APP_NAME}.fly.dev"
if [ -n "$CUSTOM_DOMAIN" ]; then
    APP_URL="https://${CUSTOM_DOMAIN}"
else
    APP_URL="https://${WEB_APP_NAME}.fly.dev"
fi

fly secrets set \
    API_URL="$API_URL" \
    --app "$WEB_APP_NAME"

cd apps/web
fly deploy \
    --app "$WEB_APP_NAME" \
    --build-arg NEXT_PUBLIC_APP_URL="$APP_URL" \
    --build-arg NEXT_PUBLIC_API_URL="$API_URL" \
    --build-arg API_URL="$API_URL"
cd ../..

# Step 6: Health check
echo ""
echo -e "${GREEN}Step 6: Health checks...${NC}"
echo "API: $(curl -s https://${API_APP_NAME}.fly.dev/health)"
echo "Web: $(curl -sI https://${WEB_APP_NAME}.fly.dev | head -1)"

# Step 7: Custom domain (optional)
if [ -n "$CUSTOM_DOMAIN" ]; then
    echo ""
    echo -e "${GREEN}Step 7: Setting up custom domain...${NC}"
    fly certs create "$CUSTOM_DOMAIN" --app "$WEB_APP_NAME"
    echo ""
    echo -e "${YELLOW}Add this DNS record to your domain:${NC}"
    echo "  Type: CNAME"
    echo "  Name: $(echo $CUSTOM_DOMAIN | cut -d. -f1)"
    echo "  Value: ${WEB_APP_NAME}.fly.dev"
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo "URLs:"
echo "  API: https://${API_APP_NAME}.fly.dev"
echo "  Web: https://${WEB_APP_NAME}.fly.dev"
if [ -n "$CUSTOM_DOMAIN" ]; then
    echo "  Custom: https://${CUSTOM_DOMAIN} (after DNS propagation)"
fi
echo ""
echo "Useful commands:"
echo "  fly logs --app $API_APP_NAME     # View API logs"
echo "  fly logs --app $WEB_APP_NAME     # View Web logs"
echo "  fly status --app $API_APP_NAME   # Check API status"
echo "  fly postgres connect -a $DB_NAME # Connect to database"
