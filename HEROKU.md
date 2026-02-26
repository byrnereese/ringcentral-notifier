# Deploying to Heroku

This guide explains how to deploy the RingCentral Notifier app to Heroku.

## Prerequisites

1.  **Heroku CLI**: Install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli).
2.  **Git**: Ensure Git is installed and initialized in your project.

## Important Note: Database Persistence

**⚠️ WARNING: This application currently uses SQLite (`better-sqlite3`).**

On Heroku, the filesystem is **ephemeral**. This means that any data written to the `database.sqlite` file will be **lost** whenever the application restarts (which happens at least once every 24 hours, or whenever you deploy new code).

For a production deployment with persistent data, you must migrate the database layer to use a persistent database service like **PostgreSQL**. This would require code changes in `server/db.ts` and `server.ts` to use a PostgreSQL client (e.g., `pg` or an ORM like `Prisma` or `Drizzle`) instead of `better-sqlite3`.

**See [POSTGRES_MIGRATION.md](./POSTGRES_MIGRATION.md) for detailed instructions on how to migrate.**

For demonstration purposes, you can deploy as-is, but be aware that **all user data, notifiers, and logs will be reset periodically.**

## Deployment Steps

1.  **Login to Heroku**:
    ```bash
    heroku login
    ```

2.  **Create a Heroku App**:
    ```bash
    heroku create your-app-name
    ```
    *(Replace `your-app-name` with a unique name)*

3.  **Set Environment Variables**:
    You need to configure the environment variables on Heroku.

    ```bash
    # RingCentral Configuration
    heroku config:set RC_CLIENT_ID="your_rc_client_id"
    heroku config:set RC_CLIENT_SECRET="your_rc_client_secret"
    heroku config:set RC_SERVER_URL="https://platform.ringcentral.com" # or https://platform.devtest.ringcentral.com for sandbox

    # App Configuration
    heroku config:set APP_URL="https://your-app-name.herokuapp.com"
    heroku config:set NODE_ENV="production"
    
    # Optional: Google Gemini API Key (if used)
    heroku config:set GEMINI_API_KEY="your_gemini_api_key"
    ```

4.  **Deploy Code**:
    ```bash
    git push heroku main
    ```

5.  **Open the App**:
    ```bash
    heroku open
    ```

## Troubleshooting

*   **Logs**: To view server logs:
    ```bash
    heroku logs --tail
    ```
*   **Build Errors**: If the build fails, check the logs. Ensure all dependencies are listed in `package.json` under `dependencies` (not `devDependencies` if they are needed at runtime).
