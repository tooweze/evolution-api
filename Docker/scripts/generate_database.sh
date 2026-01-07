#!/bin/bash

source ./Docker/scripts/env_functions.sh

if [ "$DOCKER_ENV" != "true" ]; then
    export_env_vars
fi

# Use default provider if not set (during build, env vars may not be available)
DATABASE_PROVIDER=${DATABASE_PROVIDER:-postgresql}

if [[ "$DATABASE_PROVIDER" == "postgresql" || "$DATABASE_PROVIDER" == "mysql" || "$DATABASE_PROVIDER" == "psql_bouncer" ]]; then
    echo "Generating database for $DATABASE_PROVIDER"
    if [ -n "$DATABASE_URL" ]; then
        echo "Database URL: $DATABASE_URL"
        export DATABASE_URL
    else
        echo "Warning: DATABASE_URL not set, but continuing with Prisma generate (schema-based)"
    fi
    npm run db:generate
    if [ $? -ne 0 ]; then
        echo "Prisma generate failed"
        exit 1
    else
        echo "Prisma generate succeeded"
    fi
else
    echo "Error: Database provider $DATABASE_PROVIDER invalid."
    exit 1
fi
