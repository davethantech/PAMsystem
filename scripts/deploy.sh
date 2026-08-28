#!/bin/bash

# =============================================================================
# Keyrail PAM - Full Deployment Script
# 
# This script provides a unified interface for deploying the Keyrail PAM platform.
# It can deploy the frontend to Vercel and the backend to various providers.
# 
# Usage:
#   ./scripts/deploy.sh [frontend-provider] [backend-provider] [options]
# 
# Providers:
#   Frontend: vercel (default)
#   Backend: railway (default), render, fly, docker
# 
# Options:
#   --prod       Deploy to production
#   --dry-run    Test the deployment without actually deploying
#   --help       Show this help message
# 
# Examples:
#   ./scripts/deploy.sh vercel railway --prod
#   ./scripts/deploy.sh vercel docker --dry-run
#   ./scripts/deploy.sh --help
# 
# Prerequisites:
#   - Node.js and npm installed
#   - Docker installed (for docker backend)
#   - Provider CLIs installed (vercel, railway, render, fly)
#   - Accounts with the selected providers
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
FRONTEND_PROVIDER="vercel"
BACKEND_PROVIDER="railway"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        vercel)
            FRONTEND_PROVIDER="vercel"
            shift
            ;;
        railway|render|fly|docker)
            BACKEND_PROVIDER="$1"
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
            echo "Usage: $0 [frontend-provider] [backend-provider] [options]"
            echo ""
            echo "Providers:"
            echo "  Frontend: vercel (default)"
            echo "  Backend: railway (default), render, fly, docker"
            echo ""
            echo "Options:"
            echo "  --prod       Deploy to production"
            echo "  --dry-run    Test deployment without actually deploying"
            echo "  --help       Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 vercel railway --prod"
            echo "  $0 vercel docker --dry-run"
            echo "  $0 --help"
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

# Function to deploy frontend
deploy_frontend() {
    print_section "Deploying Frontend to $FRONTEND_PROVIDER"
    
    case "$FRONTEND_PROVIDER" in
        vercel)
            if [ "$DRY_RUN" = true ]; then
                print_step "[DRY RUN] Would deploy frontend to Vercel"
                print_success "Frontend deployment (dry run) completed"
            else
                print_step "Deploying frontend to Vercel..."
                if ! ./scripts/deploy-vercel.sh --prod=$DEPLOY_TO_PROD; then
                    print_error "Frontend deployment failed"
                    exit 1
                fi
                print_success "Frontend deployed to Vercel"
            fi
            ;;
        *)
            print_error "Unsupported frontend provider: $FRONTEND_PROVIDER"
            exit 1
            ;;
    esac
}

# Function to deploy backend
deploy_backend() {
    print_section "Deploying Backend to $BACKEND_PROVIDER"
    
    case "$BACKEND_PROVIDER" in
        railway|render|fly|docker)
            if [ "$DRY_RUN" = true ]; then
                print_step "[DRY RUN] Would deploy backend to $BACKEND_PROVIDER"
                print_success "Backend deployment (dry run) completed"
            else
                print_step "Deploying backend to $BACKEND_PROVIDER..."
                if ! ./scripts/deploy-backend.sh $BACKEND_PROVIDER --prod=$DEPLOY_TO_PROD; then
                    print_error "Backend deployment failed"
                    exit 1
                fi
                print_success "Backend deployed to $BACKEND_PROVIDER"
            fi
            ;;
        *)
            print_error "Unsupported backend provider: $BACKEND_PROVIDER"
            exit 1
            ;;
    esac
}

# Function to show deployment summary
show_summary() {
    print_section "Deployment Summary"
    
    echo ""
    echo "Deployment Configuration:"
    echo "  Frontend Provider: $FRONTEND_PROVIDER"
    echo "  Backend Provider: $BACKEND_PROVIDER"
    echo "  Target: $( [ "$DEPLOY_TO_PROD" = true ] && echo "Production" || echo "Development" )"
    echo "  Mode: $( [ "$DRY_RUN" = true ] && echo "Dry Run" || echo "Live" )"
    echo ""
    
    if [ "$DRY_RUN" = false ]; then
        echo "Next Steps:"
        echo ""
        
        if [ "$DEPLOY_TO_PROD" = true ]; then
            echo "1. Configure your custom domain in $FRONTEND_PROVIDER dashboard"
            echo "2. Set up SSL certificates"
            echo "3. Configure monitoring and alerts"
            echo "4. Test all features in production"
            echo "5. Set up CI/CD for automatic deployments"
        else
            echo "1. Test your deployment thoroughly"
            echo "2. Verify all features work correctly"
            echo "3. Deploy to production when ready:"
            echo "   ./scripts/deploy.sh $FRONTEND_PROVIDER $BACKEND_PROVIDER --prod"
        fi
        
        echo ""
    fi
    
    echo "Documentation:"
    echo "  - Vercel Deployment: docs/deployment/vercel.md"
    echo "  - Architecture: docs/architecture/overview.md"
    echo "  - Security: docs/security/invariants.md"
    echo "  - Backend Configuration: docs/architecture/services.md"
    echo ""
    
    echo "Support:"
    echo "  - Vercel: https://vercel.com/docs"
    echo "  - Railway: https://docs.railway.app"
    echo "  - Render: https://render.com/docs"
    echo "  - Fly.io: https://fly.io/docs"
    echo ""
}

# Function to check prerequisites
check_prerequisites() {
    print_section "Checking Prerequisites"
    
    local required_commands=("node" "npm")
    
    for cmd in "${required_commands[@]}"; do
        if ! command_exists "$cmd"; then
            print_error "$cmd is not installed"
            exit 1
        fi
        print_success "$cmd: $(eval $cmd --version 2>/dev/null || echo "installed")"
    done
    
    # Check provider-specific CLIs
    if [ "$FRONTEND_PROVIDER" = "vercel" ] && ! command_exists vercel; then
        print_error "Vercel CLI is not installed"
        echo "Install it with: npm install -g vercel"
        exit 1
    fi
    
    case "$BACKEND_PROVIDER" in
        railway)
            if ! command_exists railway; then
                print_error "Railway CLI is not installed"
                echo "Install it with: npm install -g @railway/cli"
                exit 1
            fi
            ;;
        render)
            if ! command_exists render; then
                print_error "Render CLI is not installed"
                echo "Install it with: npm install -g @render-inc/cli"
                exit 1
            fi
            ;;
        fly)
            if ! command_exists fly; then
                print_error "Fly CLI is not installed"
                echo "Install it with: curl -L https://fly.io/install.sh | sh"
                exit 1
            fi
            ;;
        docker)
            if ! command_exists docker; then
                print_error "Docker is not installed"
                echo "Install it from https://www.docker.com/"
                exit 1
            fi
            ;;
    esac
    
    print_success "All prerequisites met"
}

# Main deployment function
main() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║            Keyrail PAM - Full Deployment Script                ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    echo -e "${YELLOW}Configuration:${NC}"
    echo "  Frontend: $FRONTEND_PROVIDER"
    echo "  Backend: $BACKEND_PROVIDER"
    echo "  Target: $( [ "$DEPLOY_TO_PROD" = true ] && echo "Production" || echo "Development" )"
    echo "  Mode: $( [ "$DRY_RUN" = true ] && echo "Dry Run" || echo "Live" )"
    echo ""
    
    # Check prerequisites
    check_prerequisites
    
    # Deploy frontend
    deploy_frontend
    
    # Deploy backend
    deploy_backend
    
    # Show summary
    show_summary
    
    echo ""
    echo -e "${GREEN}Full deployment process completed successfully!${NC}"
    echo ""
}

# Run main function
main "$@"
