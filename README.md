# Hackaton

A simple Node.js HTTP server that returns HTML.

## Installation

1. Ensure you have Node.js installed.
2. Run `npm install` to install dependencies.

## Configuration

- Create a `.env` file in the root directory with your environment variables.
- To use Claude, add:
  - `CLAUDE_API_KEY=your_claude_api_key`
  - `CLAUDE_MODEL=claude-3-5-sonnet-20241022` (optional, defaults to claude-3-5-sonnet-20241022)
- Example `.env`:
```
PORT=3000
CLAUDE_API_KEY=your_claude_api_key
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

The app uses Claude for content generation when `CLAUDE_API_KEY` is provided.

## Running the Server

- Run `npm start` to start the server.
- The server will run on the port specified in `.env` (default 3000).
- Open your browser and navigate to http://localhost:{PORT}/ to see the default HTML response.
- Visit http://localhost:{PORT}/generate-page for a generated page.

## API Endpoints

- `GET /`: Returns a simple "Hello World" page.
- `GET /generate-page`: Returns a basic generated page.
- `GET /generate-form`: Returns an HTML form to input a prompt for content generation.
- `GET /generate-content?prompt=your_prompt_here`: Generates and returns a full HTML page with header, AI-generated content based on the prompt, and footer.
- `GET /public/<filename>`: Serves static files from the public folder (images, CSS, JS).

## Static Files

Place images, CSS, and other static assets in the `public` folder. Access them with:
```
<img src="/public/image.png" alt="Description">
<link rel="stylesheet" href="/public/style.css">
<script src="/public/script.js"></script>
```

## Debugging

Use VS Code's debugger with the provided launch configuration.