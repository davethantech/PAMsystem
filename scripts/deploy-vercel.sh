#!/bin/bash

# =============================================================================
# Keyrail PAM - Vercel Deployment Script
# 
# This script automates the deployment of the Keyrail PAM frontend to Vercel.
# 
# Usage:
#   ./scripts/deploy-vercel.sh [--prod] [--dry-run]
# 
# Options:
#   --prod       Deploy to production (default: preview deployment)
#   --dry-run    Test the deployment without actually deploying
#   --help       Show this help message
# 
# Prerequisites:
#   - Vercel CLI installed (npm install -g vercel)
#   - Logged in to Vercel (vercel login)
#   - Project linked to Vercel (vercel link)
#   - Node.js and npm installed
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
PROJECT_NAME="keyrail-pam"
FRONTEND_DIR="."
BUILD_CMD="npm run build"
OUTPUT_DIR="dist"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prod)
            DEPLOY_TO_PROD=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--prod] [--dry-run] [--help]"
            echo ""
            echo "Options:"
            echo "  --prod       Deploy to production"
            echo "  --dry-run    Test deployment without actually deploying"
            echo "  --help       Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option '$1'${NC}"
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
    
    # Check Vercel CLI
    if ! command_exists vercel; then
        print_error "Vercel CLI is not installed"
        echo "Install it with: npm install -g vercel"
        exit 1
    fi
    print_success "Vercel CLI: $(vercel --version)"
    
    # Check if logged in to Vercel
    if ! vercel whoami >/dev/null 2>&1; then
        print_error "Not logged in to Vercel"
        echo "Run: vercel login"
        exit 1
    fi
    print_success "Logged in to Vercel as: $(vercel whoami)"
    
    # Check if project is linked
    if [ ! -f "vercel.json" ]; then
        print_error "Project not linked to Vercel"
        echo "Run: vercel link"
        exit 1
    fi
    print_success "Project linked to Vercel"
}

# Function to validate environment
validate_environment() {
    print_section "Validating Environment"
    
    # Check if .env.local exists
    if [ ! -f ".env.local" ]; then
        print_error ".env.local not found"
        echo "Create .env.local from .env.vercel.example:"
        echo "  cp .env.vercel.example .env.local"
        exit 1
    fi
    print_success ".env.local exists"
    
    # Check required environment variables
    REQUIRED_VARS=(
        "NEXT_PUBLIC_APP_URL"
        "NEXT_PUBLIC_API_URL"
        "NEXT_PUBLIC_WS_URL"
    )
    
    for var in "${REQUIRED_VARS[@]}"; do
        if ! grep -q "^${var}=" .env.local; then
            print_error "Required environment variable $var not set in .env.local"
            exit 1
        fi
    done
    print_success "All required environment variables are set"
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        print_error "package.json not found"
        exit 1
    fi
    print_success "package.json exists"
}

# Function to install dependencies
install_dependencies() {
    print_section "Installing Dependencies"
    
    print_step "Installing npm dependencies..."
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: npm install"
    else
        npm install
        print_success "Dependencies installed"
    fi
}

# Function to build the frontend
build_frontend() {
    print_section "Building Frontend"
    
    print_step "Running build command: $BUILD_CMD..."
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: $BUILD_CMD"
    else
        if ! $BUILD_CMD; then
            print_error "Build failed"
            exit 1
        fi
        print_success "Frontend built successfully"
    fi
    
    # Verify build output
    if [ ! -d "$OUTPUT_DIR" ]; then
        print_error "Build output directory $OUTPUT_DIR not found"
        exit 1
    fi
    print_success "Build output verified"
}

# Function to deploy to Vercel
deploy_to_vercel() {
    print_section "Deploying to Vercel"
    
    local deploy_cmd="vercel deploy"
    
    if [ "$DEPLOY_TO_PROD" = true ]; then
        deploy_cmd="vercel deploy --prod"
        print_step "Deploying to production..."
    else
        print_step "Deploying preview..."
    fi
    
    if [ "$DRY_RUN" = true ]; then
        print_success "[DRY RUN] Would run: $deploy_cmd"
        echo ""
        echo "Deployment summary:"
        echo "  - Project: $PROJECT_NAME"
        echo "  - Target: $( [ "$DEPLOY_TO_PROD" = true ] && echo "Production" || echo "Preview" )"
        echo "  - Build command: $BUILD_CMD"
        echo "  - Output directory: $OUTPUT_DIR"
        return 0
    fi
    
    # Run deployment
    if ! $deploy_cmd; then
        print_error "Deployment failed"
        exit 1
    fi
    
    print_success "Deployment successful"
    
    # Get deployment URL
    if [ "$DEPLOY_TO_PROD" = true ]; then
        echo ""
        echo -e "${GREEN}Production deployment complete!${NC}"
        echo "Your application is now live at: https://$(vercel inspect --output json | jq -r '.url')"
    else
        echo ""
        echo -e "${GREEN}Preview deployment complete!${NC}"
        echo "Preview URL: https://$(vercel inspect --output json | jq -r '.url')"
    fi
}

# Function to show deployment information
show_deployment_info() {
    print_section "Deployment Information"
    
    echo ""
    echo "Next Steps:"
    echo ""
    
    if [ "$DEPLOY_TO_PROD" = true ]; then
        echo "1. Configure your custom domain in Vercel dashboard"
        echo "2. Set up SSL certificates"
        echo "3. Configure CORS in your backend to allow requests from:"
        echo "   $(grep NEXT_PUBLIC_APP_URL .env.local | cut -d'=' -f2)"
    else
        echo "1. Test your preview deployment"
        echo "2. Verify all features work correctly"
        echo "3. Deploy to production when ready:"
        echo "   ./scripts/deploy-vercel.sh --prod"
    fi
    
    echo ""
    echo "Backend Deployment Options:"
    echo "  - Railway: https://railway.app"
    echo "  - Render: https://render.com"
    echo "  - Fly.io: https://fly.io"
    echo "  - Self-hosted: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
    echo ""
    echo "Documentation:"
    echo "  - Vercel Deployment: docs/deployment/vercel.md"
    echo "  - Architecture: docs/architecture/overview.md"
    echo "  - Security: docs/security/invariants.md"
    echo ""
}

# Main deployment function
main() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║          Keyrail PAM - Vercel Deployment Script              ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Check prerequisites
    check_prerequisites
    
    # Validate environment
    validate_environment
    
    # Install dependencies
    install_dependencies
    
    # Build frontend
    build_frontend
    
    # Deploy to Vercel
    deploy_to_vercel
    
    # Show deployment information
    show_deployment_info
    
    echo ""
    echo -e "${GREEN}Deployment process completed successfully!${NC}"
    echo ""
}

# Run main function
main "$@"
