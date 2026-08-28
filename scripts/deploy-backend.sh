#!/bin/bash

# =============================================================================
# Keyrail PAM - Backend Deployment Script
# 
# This script automates the deployment of the Keyrail PAM backend to various
# hosting providers. The backend must be deployed separately from the frontend
# when using Vercel for the frontend.
# 
# Usage:
#   ./scripts/deploy-backend.sh [provider] [--prod] [--dry-run]
# 
# Providers:
#   railway      Deploy to Railway.app (recommended)
#   render       Deploy to Render.com
#   fly          Deploy to Fly.io
#   docker       Build and run with Docker Compose (for VPS)
#   
# Options:
#   --prod       Deploy to production
#   --dry-run    Test the deployment without actually deploying
#   --help       Show this help message
# 
# Prerequisites:
#   - Node.js and npm installed
#   - Docker installed (for docker provider)
#   - Provider CLI installed (railway, render, fly)
#   - Account with the selected provider
# 
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DEPLOY_TO_PROD=false
DRY_RUN=false
PROVIDER=""
BACKEND_DIR="backend"
FRONTEND_URL=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        railway|render|fly|docker)
            PROVIDER="$1"
            shift
            ;;
        --prod)
            DEPLOY_TO_PROD=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [provider] [--prod] [--dry-run] [--help]"
            echo ""
            echo "Providers:"
            echo "  railway      Deploy to Railway.app (recommended)"
            echo "  render       Deploy to Render.com"
            echo "  fly          Deploy to Fly.io"
            echo "  docker       Build and run with Docker Compose (for VPS)"
            echo ""
            echo "Options:"
            echo "  --prod       Deploy to production"
            echo "  --dry-run    Test deployment without actually deploying"
            echo "  --help       Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 railway --prod"
            echo "  $0 render --dry-run"
            echo "  $0 docker"
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option or provider '$1'${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Function to print section headers
print_section() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

# Function to print step messages
print_step() {
    echo -e "${YELLOW}→${NC} $1"
}

# Function to print success messages
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Function to print error messages
print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    print_section "Checking Prerequisites"
    
    # Check Node.js
    if ! command_exists node; then
        print_error "Node.js is not installed"
        echo "Please install Node.js from https://nodejs.org/"
        exit 1
    fi
    print_success "Node.js: $(node --version)"
    
    # Check npm
    if ! command_exists npm; then
        print_error "npm is not installed"
        echo "Please install npm (comes with Node.js)"
        exit 1
    fi
    print_success "npm: $(npm --version)"
    
    # Check Docker (for docker provider)
    if [ "$PROVIDER" = "docker" ] && ! command_exists docker; then
        print_error "Docker is not installed"
        echo "Please install Docker from https://www.docker.com/"
        exit 1
    fi
    
    if [ "$PROVIDER" = "docker" ] && command_exists docker; then
        print_success "Docker: $(docker --version)"
    fi
    
    # Check backend directory
    if [ ! -d "$BACKEND_DIR" ]; then
        print_error "Backend directory $BACKEND_DIR not found"
        exit 1
    fi
    print_success "Backend directory found"
    
    # Check backend package.json
    if [ ! -f "$BACKEND_DIR/package.json" ]; then
        print_error "Backend package.json not found"
        exit 1
    fi
    print_success "Backend package.json found"
}

# Function to load frontend URL from environment
load_frontend_url() {
    if [ -f ".env.local" ]; then
        FRONTEND_URL=$(grep "^NEXT_PUBLIC_APP_URL=" .env.local | cut -d'=' -f2)
    fi
    
    if [ -z "$FRONTEND_URL" ]; then
        if [ -f ".env" ]; then
            FRONTEND_URL=$(grep "^NEXT_PUBLIC_APP_URL=" .env | cut -d'=' -f2)
        fi
    fi
    
    if [ -z "$FRONTEND_URL" ]; then
        FRONTEND_URL="https://pam.your-domain.com"
        echo -e "${YELLOW}Warning: Frontend URL not found in environment files${NC}"
        echo "Using default: $FRONTEND_URL"
    fi
}

# Function to validate backend environment
validate_backend_environment() {
    print_section "Validating Backend Environment"
    
    local required_vars=(
        "DATABASE_URL"
        "REDIS_URL"
        "JWT_SECRET"
        "SESSION_ENCRYPTION_KEY"
        "ARGON2_SECRET"
    )
    
    local missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [ -f "$BACKEND_DIR/.env" ]; then
            if ! grep -q "^${var}=" "$BACKEND_DIR/.env"; then
                missing_vars+=("$var")
            fi
        else
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        echo ""
        echo "Create $BACKEND_DIR/.env with the required variables."
        echo "See .env.production.example for a template."
        exit 1
    fi
    
    print_success "All required environment variables are configured"
}

# Function to build the backend
build_backend() {
    print_section "Building Backend"
    
    print_step "Installing backend dependencies..."
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: cd $BACKEND_DIR && npm install"
    else
        if ! (cd "$BACKEND_DIR" && npm install); then
            print_error "Failed to install backend dependencies"
            exit 1
        fi
        print_success "Backend dependencies installed"
    fi
    
    print_step "Building backend..."
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: cd $BACKEND_DIR && npm run build"
    else
        if ! (cd "$BACKEND_DIR" && npm run build); then
            print_error "Backend build failed"
            exit 1
        fi
        print_success "Backend built successfully"
    fi
}

# Function to deploy to Railway
deploy_to_railway() {
    print_section "Deploying to Railway.app"
    
    # Check Railway CLI
    if ! command_exists railway; then
        print_error "Railway CLI is not installed"
        echo "Install it with: npm install -g @railway/cli"
        exit 1
    fi
    print_success "Railway CLI: $(railway --version)"
    
    # Check if logged in
    if ! railway whoami >/dev/null 2>&1; then
        print_error "Not logged in to Railway"
        echo "Run: railway login"
        exit 1
    fi
    print_success "Logged in to Railway as: $(railway whoami)"
    
    print_step "Deploying backend to Railway..."
    
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: railway up"
        echo ""
        echo "Railway Deployment Summary:"
        echo "  - Provider: Railway.app"
        echo "  - Target: $( [ "$DEPLOY_TO_PROD" = true ] && echo "Production" || echo "Development" )"
        echo "  - Backend directory: $BACKEND_DIR"
        echo "  - Frontend URL: $FRONTEND_URL"
        return 0
    fi
    
    # Create or select project
    if [ "$DEPLOY_TO_PROD" = true ]; then
        PROJECT_NAME="keyrail-pam-prod"
    else
        PROJECT_NAME="keyrail-pam-dev"
    fi
    
    # Navigate to backend directory and deploy
    if ! (cd "$BACKEND_DIR" && railway up --name "$PROJECT_NAME"); then
        print_error "Railway deployment failed"
        exit 1
    fi
    
    print_success "Railway deployment successful"
    
    # Get deployment URL
    RAILWAY_URL=$(cd "$BACKEND_DIR" && railway url 2>/dev/null || echo "")
    
    if [ -n "$RAILWAY_URL" ]; then
        echo ""
        echo -e "${GREEN}Railway deployment complete!${NC}"
        echo "Backend URL: $RAILWAY_URL"
        echo ""
        echo "Configure your frontend to use this backend URL:"
        echo "  NEXT_PUBLIC_API_URL=$RAILWAY_URL"
        echo "  NEXT_PUBLIC_WS_URL=wss://$(echo $RAILWAY_URL | sed 's|https://||')"
    fi
}

# Function to deploy to Render
deploy_to_render() {
    print_section "Deploying to Render.com"
    
    # Check Render CLI
    if ! command_exists render; then
        print_error "Render CLI is not installed"
        echo "Install it with: npm install -g @render-inc/cli"
        exit 1
    fi
    
    print_step "Deploying backend to Render..."
    
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: render blueprint create && render deploy"
        echo ""
        echo "Render Deployment Summary:"
        echo "  - Provider: Render.com"
        echo "  - Target: $( [ "$DEPLOY_TO_PROD" = true ] && echo "Production" || echo "Development" )"
        echo "  - Backend directory: $BACKEND_DIR"
        echo "  - Frontend URL: $FRONTEND_URL"
        return 0
    fi
    
    # Navigate to backend directory
    if ! (cd "$BACKEND_DIR" && render blueprint create); then
        print_error "Failed to create Render blueprint"
        exit 1
    fi
    
    if ! (cd "$BACKEND_DIR" && render deploy); then
        print_error "Render deployment failed"
        exit 1
    fi
    
    print_success "Render deployment successful"
    
    echo ""
    echo -e "${GREEN}Render deployment complete!${NC}"
    echo "Check your Render dashboard for the deployment URL"
}

# Function to deploy to Fly.io
deploy_to_fly() {
    print_section "Deploying to Fly.io"
    
    # Check Fly CLI
    if ! command_exists fly; then
        print_error "Fly CLI is not installed"
        echo "Install it with: curl -L https://fly.io/install.sh | sh"
        exit 1
    fi
    print_success "Fly CLI: $(fly --version)"
    
    # Check if logged in
    if ! fly auth whoami >/dev/null 2>&1; then
        print_error "Not logged in to Fly.io"
        echo "Run: fly auth login"
        exit 1
    fi
    print_success "Logged in to Fly.io as: $(fly auth whoami)"
    
    print_step "Deploying backend to Fly.io..."
    
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: fly launch && fly deploy"
        echo ""
        echo "Fly.io Deployment Summary:"
        echo "  - Provider: Fly.io"
        echo "  - Target: $( [ "$DEPLOY_TO_PROD" = true ] && echo "Production" || echo "Development" )"
        echo "  - Backend directory: $BACKEND_DIR"
        echo "  - Frontend URL: $FRONTEND_URL"
        return 0
    fi
    
    # Navigate to backend directory
    if ! (cd "$BACKEND_DIR" && fly launch); then
        print_error "Fly.io launch failed"
        exit 1
    fi
    
    # Set environment variables
    print_step "Configuring environment variables..."
    
    # Get app name from fly.toml
    if [ -f "$BACKEND_DIR/fly.toml" ]; then
        APP_NAME=$(grep "^app = " "$BACKEND_DIR/fly.toml" | cut -d'"' -f2)
    else
        APP_NAME="keyrail-pam-backend"
    fi
    
    # Set CORS origins
    if ! flyctl secrets set \
        CORS_ORIGINS="$FRONTEND_URL" \
        --app "$APP_NAME" 2>/dev/null; then
        echo -e "${YELLOW}Warning: Failed to set CORS_ORIGINS${NC}"
    fi
    
    # Deploy
    if ! (cd "$BACKEND_DIR" && fly deploy); then
        print_error "Fly.io deployment failed"
        exit 1
    fi
    
    print_success "Fly.io deployment successful"
    
    # Get deployment URL
    FLY_URL=$(flyctl apps get "$APP_NAME" --json 2>/dev/null | jq -r '.hostname' || echo "")
    
    if [ -n "$FLY_URL" ]; then
        echo ""
        echo -e "${GREEN}Fly.io deployment complete!${NC}"
        echo "Backend URL: https://$FLY_URL"
        echo ""
        echo "Configure your frontend to use this backend URL:"
        echo "  NEXT_PUBLIC_API_URL=https://$FLY_URL"
        echo "  NEXT_PUBLIC_WS_URL=wss://$FLY_URL"
    fi
}

# Function to deploy with Docker
deploy_with_docker() {
    print_section "Deploying with Docker Compose"
    
    # Check if .env.production exists
    if [ ! -f ".env.production" ]; then
        print_error ".env.production not found"
        echo "Create .env.production from .env.production.example:"
        echo "  cp .env.production.example .env.production"
        exit 1
    fi
    print_success ".env.production found"
    
    print_step "Starting services with Docker Compose..."
    
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
        echo ""
        echo "Docker Deployment Summary:"
        echo "  - Provider: Docker Compose"
        echo "  - Target: Production"
        echo "  - Configuration: docker-compose.yml + docker-compose.prod.yml"
        echo "  - Frontend URL: $FRONTEND_URL"
        return 0
    fi
    
    # Start services
    if ! docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d; then
        print_error "Docker Compose failed"
        exit 1
    fi
    
    print_success "Docker services started"
    
    echo ""
    echo -e "${GREEN}Docker deployment complete!${NC}"
    echo "Services running:"
    echo "  - Frontend: http://localhost:3000"
    echo "  - Backend: http://localhost:4000"
    echo "  - PostgreSQL: localhost:5432"
    echo "  - Redis: localhost:6379"
    echo ""
    echo "To stop services: docker compose down"
    echo "To view logs: docker compose logs -f"
}

# Function to show deployment information
show_backend_deployment_info() {
    print_section "Backend Deployment Information"
    
    echo ""
    echo "Next Steps:"
    echo ""
    
    if [ "$DEPLOY_TO_PROD" = true ]; then
        echo "1. Configure CORS in your backend to allow requests from:"
        echo "   $FRONTEND_URL"
        echo ""
        echo "2. Update your frontend environment variables:"
        echo "   NEXT_PUBLIC_API_URL=<backend-url>"
        echo "   NEXT_PUBLIC_WS_URL=wss://<backend-host>"
        echo ""
        echo "3. Redeploy your frontend with the new backend URL"
    else
        echo "1. Test your backend deployment"
        echo "2. Verify API endpoints are working"
        echo "3. Deploy to production when ready:"
        echo "   ./scripts/deploy-backend.sh $PROVIDER --prod"
    fi
    
    echo ""
    echo "Backend Configuration:"
    echo "  - Ensure DATABASE_URL points to your PostgreSQL instance"
    echo "  - Ensure REDIS_URL points to your Redis instance"
    echo "  - Ensure all security secrets are properly set"
    echo "  - Enable RLS (Row Level Security) in PostgreSQL"
    echo ""
    echo "Documentation:"
    echo "  - Backend Configuration: docs/architecture/services.md"
    echo "  - Database Setup: database/README.md"
    echo "  - Security: docs/security/invariants.md"
    echo ""
}

# Main deployment function
main() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║       Keyrail PAM - Backend Deployment Script                ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Check if provider is specified
    if [ -z "$PROVIDER" ]; then
        print_error "No provider specified"
        echo "Available providers: railway, render, fly, docker"
        echo "Use --help for usage information"
        exit 1
    fi
    
    echo -e "${YELLOW}Deploying backend to $PROVIDER...${NC}"
    echo ""
    
    # Check prerequisites
    check_prerequisites
    
    # Load frontend URL
    load_frontend_url
    
    # Validate backend environment
    validate_backend_environment
    
    # Build backend
    build_backend
    
    # Deploy based on provider
    case "$PROVIDER" in
        railway)
            deploy_to_railway
            ;;
        render)
            deploy_to_render
            ;;
        fly)
            deploy_to_fly
            ;;
        docker)
            deploy_with_docker
            ;;
        *)
            print_error "Unknown provider: $PROVIDER"
            exit 1
            ;;
    esac
    
    # Show deployment information
    show_backend_deployment_info
    
    echo ""
    echo -e "${GREEN}Backend deployment process completed successfully!${NC}"
    echo ""
}

# Run main function
main "$@"
