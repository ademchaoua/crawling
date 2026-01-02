# Crawling Project

<div align="center">
  <pre>
_________                       ______            
__  ____/____________ ___      ____  /____________
_  /    __  ___/  __ `/_ | /| / /_  /_  _ \_  ___/
/ /___  _  /   / /_/ /__ |/ |/ /_  / /  __/  /    
\____/  /_/    \__,_/ ____/|__/ /_/  \___//_/     
  </pre>
  <h1>Web Crawler</h1>
  <p>A powerful and resource-efficient web crawler built with Node.js. It features an interactive CLI dashboard, and robust job management.</p>
</div>

<div align="center">

![GitHub stars](https://img.shields.io/github/stars/ademchaoua/crawling?style=social)
![GitHub forks](https://img.shields.io/github/forks/ademchaoua/crawling?style=social)

</div>

<p align="center">
  <a href="#-key-features">Key Features</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-running-the-application">Running the App</a> •
  <a href="#-contributing">Contributing</a> •
  <a href="#-license">License</a>
</p>

![Node.js](https://img.shields.io/badge/node.js-v20.x-green.svg)
![NPM](https://img.shields.io/badge/npm-v10.x-blue.svg)
![License](https://img.shields.io/github/license/ademchaoua/crawling)
![GitHub issues](https://img.shields.io/github/issues/ademchaoua/crawling)
![GitHub pull requests](https://img.shields.io/github/issues-pr/ademchaoua/crawling)
![GitHub last commit](https://img.shields.io/github/last-commit/ademchaoua/crawling)
![GitHub repo size](https://img.shields.io/github/repo-size/ademchaoua/crawling)
![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)

## ✨ Key Features

- **Multi-Threaded Performance**: Utilizes all available CPU cores with Node.js `worker_threads` to process multiple jobs in parallel.
- **Interactive CLI Dashboard**: A real-time dashboard shows the status of the crawl queue (pending, processing, done, failed) and provides detailed statistics for each source.
- **Dynamic Job Control**: Add new crawling jobs on the fly through the interactive command line.
- **Robust Job Management**: 
  - **Automatic Retry**: Retries jobs that fail due to temporary network errors.
  - **Stuck Job Recovery**: On startup, automatically requeues jobs that were stuck in a `processing` state from a previous run.
  - **Bad Source Pruning**: Automatically detects and stops crawling from source URLs that consistently produce errors, preventing wasted resources.
- **Efficient Link Extraction**: Discovers and queues new, same-origin links from crawled pages to expand the crawl frontier.
- **Configurable Data Extraction**: Specify exactly what content to extract from pages using CSS selectors for each job.

## 🛠️ Tech Stack

- **Core**: Node.js, Worker Threads
- **Crawling**: Undici
- **Data Extraction**: Cheerio
- **Database**: MongoDB
- **CLI**: Chalk, cli-table3
- **Development**: Nodemon
- **Testing**: Vitest

## 🚀 Getting Started

### Prerequisites

- Node.js (v20 or higher)
- npm (v10 or higher)
- MongoDB

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/ademchaoua/crawling.git
    ```
2.  Navigate to the project directory:
    ```bash
    cd crawling
    ```
3.  Install the dependencies:
    ```bash
    npm install
    ```

### Configuration

Project configuration is located in `config/index.js`. You can modify settings like database connections, crawl concurrency, and retry logic there. No `.env` file is required by default.

## 🏃 Running the Application

-   **To start the crawler**, run:
    ```bash
    npm start
    ```
-   **For development with auto-reloading**, run:
    ```bash
    npm run dev
    ```

Once running, the interactive dashboard will appear.

### Interactive Commands

-   **Add a new crawl job**:
    ```
    add <url> <cssSelector1,cssSelector2,...>
    ```
    -   `<url>`: The starting URL to crawl.
    -   `<cssSelectors>`: A comma-separated list of CSS selectors to extract content from.
    -   *Example*: `add https://news.ycombinator.com .titleline,.sitebit a`

-   **Exit the application**:
    ```
    exit
    ```

## 📂 Project Structure

```
.
├── config/
│   └── index.js        # Main project configuration
├── src/
│   ├── core/
│   │   ├── processer.js  # HTML fetching, data/link extraction (Cheerio)
│   │   └── worker.js     # Core crawling logic for fetch workers
│   ├── db/
│   │   └── index.js      # MongoDB connection, collections, and queries
│   ├── logger/
│   │   └── index.js      # Console and file logging setup
│   └── main.js         # Application entry point, CLI dashboard, and worker management
├── tests/
│   └── processor.test.js # Unit tests
├── package.json
└── README.md
```

## 🤝 Contributing

Contributions are welcome! We have a [Code of Conduct](./CODE_OF_CONDUCT.md) that we expect all contributors to adhere to. Please read it before contributing.

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## 📜 License

Distributed under the ISC License.

## 📧 Contact

Adem Chaoua - adem.chaoua.1444@gmail.com

Project Link: [https://github.com/ademchaoua/crawling](https://github.com/ademchaoua/crawling)
