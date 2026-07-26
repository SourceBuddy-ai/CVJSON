/**
 * Canonical casing for skills that resumes routinely mis-case.
 *
 * This is a presentation aid, not a whitelist: unknown skills pass through
 * untouched. Restricting output to a known list would silently drop the niche
 * technologies that make a candidate interesting.
 *
 * Keys are lower-cased lookup forms.
 */
const CANONICAL: Record<string, string> = {};

function add(...names: string[]): void {
  for (const name of names) CANONICAL[name.toLowerCase()] = name;
}

// Languages
add('JavaScript', 'TypeScript', 'Python', 'Java', 'C', 'C++', 'C#', 'Go', 'Rust',
  'Ruby', 'PHP', 'Swift', 'Kotlin', 'Scala', 'Perl', 'Haskell', 'Elixir', 'Erlang',
  'Clojure', 'F#', 'OCaml', 'Lua', 'R', 'MATLAB', 'Julia', 'Dart', 'Groovy',
  'Objective-C', 'Visual Basic', 'COBOL', 'Fortran', 'Assembly', 'Solidity', 'Zig');

// Markup, query and config languages
add('HTML', 'CSS', 'Sass', 'SCSS', 'Less', 'SQL', 'GraphQL', 'XML', 'JSON', 'YAML',
  'TOML', 'Markdown', 'LaTeX', 'XPath', 'XSLT', 'Bash', 'Shell', 'PowerShell', 'Zsh');

// Frontend
add('React', 'React Native', 'Vue.js', 'Angular', 'Svelte', 'SvelteKit', 'Next.js',
  'Nuxt.js', 'Remix', 'Astro', 'jQuery', 'Redux', 'MobX', 'Zustand', 'Tailwind CSS',
  'Bootstrap', 'Material UI', 'Chakra UI', 'Webpack', 'Vite', 'Rollup', 'Babel',
  'ESLint', 'Prettier', 'Storybook', 'Three.js', 'D3.js', 'WebGL', 'WebAssembly');

// Backend and frameworks
add('Node.js', 'Express', 'NestJS', 'Fastify', 'Django', 'Flask', 'FastAPI',
  'Ruby on Rails', 'Laravel', 'Symfony', 'Spring', 'Spring Boot', 'ASP.NET',
  '.NET', '.NET Core', 'Gin', 'Echo', 'Actix', 'Phoenix', 'Deno', 'Bun', 'tRPC');

// Data stores
add('PostgreSQL', 'MySQL', 'MariaDB', 'SQLite', 'MongoDB', 'Redis', 'Cassandra',
  'DynamoDB', 'Elasticsearch', 'OpenSearch', 'Neo4j', 'CouchDB', 'InfluxDB',
  'ClickHouse', 'Snowflake', 'BigQuery', 'Redshift', 'Databricks', 'Firebase',
  'Supabase', 'PlanetScale', 'CockroachDB', 'DuckDB', 'Pinecone', 'Weaviate');

// Cloud and infrastructure
add('AWS', 'Azure', 'Google Cloud', 'GCP', 'Docker', 'Kubernetes', 'Terraform',
  'Pulumi', 'Ansible', 'Chef', 'Puppet', 'Vagrant', 'Helm', 'Istio', 'Consul',
  'Vault', 'Nginx', 'Apache', 'HAProxy', 'Cloudflare', 'Vercel', 'Netlify',
  'Heroku', 'DigitalOcean', 'Linode', 'OpenStack', 'VMware', 'Serverless',
  'Lambda', 'EC2', 'S3', 'RDS', 'EKS', 'ECS', 'CloudFormation');

// CI/CD and tooling
add('Git', 'GitHub', 'GitLab', 'Bitbucket', 'Jenkins', 'CircleCI', 'Travis CI',
  'GitHub Actions', 'ArgoCD', 'Spinnaker', 'TeamCity', 'Bamboo', 'SonarQube',
  'Datadog', 'New Relic', 'Prometheus', 'Grafana', 'Splunk', 'Sentry', 'PagerDuty',
  'Kibana', 'Logstash', 'OpenTelemetry');

// Data and ML
add('TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'Pandas', 'NumPy', 'SciPy',
  'Matplotlib', 'Seaborn', 'Jupyter', 'Apache Spark', 'Hadoop', 'Kafka', 'Airflow',
  'dbt', 'Flink', 'Beam', 'Hugging Face', 'LangChain', 'OpenCV', 'NLTK', 'spaCy',
  'XGBoost', 'LightGBM', 'MLflow', 'Kubeflow', 'Ray');

// Testing
add('Jest', 'Vitest', 'Mocha', 'Chai', 'Cypress', 'Playwright', 'Selenium',
  'Puppeteer', 'JUnit', 'TestNG', 'pytest', 'RSpec', 'Cucumber', 'Postman');

// Mobile
add('iOS', 'Android', 'SwiftUI', 'UIKit', 'Jetpack Compose', 'Flutter', 'Xamarin',
  'Ionic', 'Cordova', 'Expo');

// Design and product
add('Figma', 'Sketch', 'Adobe XD', 'InVision', 'Photoshop', 'Illustrator',
  'After Effects', 'Premiere Pro', 'InDesign', 'Blender', 'Canva', 'Framer');

// Business, PM and CRM
add('Jira', 'Confluence', 'Asana', 'Trello', 'Monday.com', 'Notion', 'Linear',
  'Slack', 'Salesforce', 'HubSpot', 'Zendesk', 'Marketo', 'Tableau', 'Power BI',
  'Looker', 'QlikView', 'SAP', 'Oracle', 'NetSuite', 'Workday', 'QuickBooks',
  'Excel', 'Microsoft Excel', 'PowerPoint', 'Microsoft Office', 'Google Analytics',
  'Mixpanel', 'Amplitude', 'Segment', 'Optimizely');

// Methodologies
add('Agile', 'Scrum', 'Kanban', 'Waterfall', 'DevOps', 'DevSecOps', 'SRE', 'CI/CD',
  'TDD', 'BDD', 'Microservices', 'REST', 'RESTful APIs', 'gRPC', 'OAuth', 'SAML',
  'SOC 2', 'GDPR', 'HIPAA', 'PCI DSS', 'ISO 27001', 'ITIL', 'Six Sigma', 'Lean',
  'PMP', 'SAFe');

/**
 * Return the canonical casing for a skill, or the input trimmed when the skill
 * is not in the lexicon.
 */
export function canonicalizeSkill(raw: string): string {
  const trimmed = raw.trim().replace(/\s{2,}/g, ' ');
  return CANONICAL[trimmed.toLowerCase()] ?? trimmed;
}

/** True when the token is a skill the lexicon recognises. Used for confidence scoring. */
export function isKnownSkill(raw: string): boolean {
  return Object.prototype.hasOwnProperty.call(CANONICAL, raw.trim().toLowerCase());
}

/** Number of entries in the lexicon. Exposed for tests. */
export function lexiconSize(): number {
  return Object.keys(CANONICAL).length;
}
