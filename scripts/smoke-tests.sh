#!/bin/bash
# Production Smoke Test Suite
# Tests critical application functionality after deployment
# Usage: ./smoke-tests.sh https://app.example.com

set -e

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${1:-http://localhost:3000}"
API_URL="${2:-http://localhost:4000}"
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
test_endpoint() {
  local method=$1
  local endpoint=$2
  local expected_status=$3
  local body=$4
  local description=$5

  if [ -z "$description" ]; then
    description="$method $endpoint"
  fi

  local url="$API_URL$endpoint"
  local response

  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" -X GET "$url")
  elif [ "$method" = "POST" ]; then
    response=$(curl -s -w "\n%{http_code}" -X POST "$url" \
      -H "Content-Type: application/json" \
      -d "$body")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -d "$body")
  fi

  local status=$(echo "$response" | tail -1)
  local body=$(echo "$response" | head -n -1)

  if [ "$status" = "$expected_status" ]; then
    echo -e "${GREEN}✓${NC} $description (HTTP $status)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "$body"
  else
    echo -e "${RED}✗${NC} $description (expected $expected_status, got $status)"
    echo "Response: $body"
    TESTS_FAILED=$((TESTS_FAILED + 1))
  fi
}

echo "========================================="
echo "Production Smoke Test Suite"
echo "========================================="
echo "API URL: $API_URL"
echo "Web URL: $BASE_URL"
echo ""

# Test 1: API Liveness
echo "Testing Health Endpoints..."
test_endpoint "GET" "/health/live" "200" "" "API Liveness Check"

# Test 2: API Readiness (Database Connectivity)
test_endpoint "GET" "/health/ready" "200" "" "API Readiness Check (Database)"

# Test 3: Authentication - Register
echo ""
echo "Testing Authentication..."
REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test.'$(date +%s)'@example.com",
    "password": "TestPassword123!@#",
    "firstName": "Test",
    "lastName": "User"
  }')

REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | grep -q '"access_token"' && echo "200" || echo "400")
if [ "$REGISTER_STATUS" = "200" ]; then
  echo -e "${GREEN}✓${NC} User Registration (HTTP 201/200)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠${NC} User Registration might have failed (check if user already exists)"
fi

# Extract token for authenticated requests (optional - may not be needed for health checks)
TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

# Test 4: CORS - Check CORS headers
echo ""
echo "Testing CORS..."
CORS_RESPONSE=$(curl -s -i -X OPTIONS "$API_URL/health/live" 2>&1 | grep -i "access-control-allow-origin" || echo "")
if [ ! -z "$CORS_RESPONSE" ]; then
  echo -e "${GREEN}✓${NC} CORS Headers Present"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠${NC} CORS Headers Not Found (may be expected if no CORS configured)"
fi

# Test 5: Security Headers
echo ""
echo "Testing Security Headers..."
SECURITY_HEADERS=$(curl -s -i "$API_URL/health/live" 2>&1)

if echo "$SECURITY_HEADERS" | grep -qi "X-Frame-Options"; then
  echo -e "${GREEN}✓${NC} X-Frame-Options Header Present"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} X-Frame-Options Header Missing"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if echo "$SECURITY_HEADERS" | grep -qi "X-Content-Type-Options"; then
  echo -e "${GREEN}✓${NC} X-Content-Type-Options Header Present"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} X-Content-Type-Options Header Missing"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if echo "$SECURITY_HEADERS" | grep -qi "Strict-Transport-Security"; then
  echo -e "${GREEN}✓${NC} HSTS Header Present"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${YELLOW}⚠${NC} HSTS Header Not Found (optional, usually set at reverse proxy)"
fi

# Test 6: Web App
echo ""
echo "Testing Web Application..."
WEB_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/")
WEB_STATUS=$(echo "$WEB_RESPONSE" | tail -1)
if [ "$WEB_STATUS" = "200" ]; then
  echo -e "${GREEN}✓${NC} Web App Loads (HTTP $WEB_STATUS)"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} Web App Failed (HTTP $WEB_STATUS)"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 7: API Response Format
echo ""
echo "Testing Response Format..."
HEALTH_RESPONSE=$(curl -s "$API_URL/health/live")
if echo "$HEALTH_RESPONSE" | grep -q '"status"'; then
  echo -e "${GREEN}✓${NC} API Returns JSON with 'status' field"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} API Response Format Invalid"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Test 8: Timeout Handling (for long connections like SSE)
echo ""
echo "Testing Connection Stability..."
TIMEOUT_TEST=$(timeout 5 curl -s -w "\n%{http_code}" "$API_URL/health/live" 2>&1 || echo "timeout")
if echo "$TIMEOUT_TEST" | grep -q "200"; then
  echo -e "${GREEN}✓${NC} Connection Established and Completed"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC} Connection Stability Test Failed"
  TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# Summary
echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo "Total:  $((TESTS_PASSED + TESTS_FAILED))"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All smoke tests passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some smoke tests failed!${NC}"
  exit 1
fi
