export type RouteId = 'start' | 'experience' | 'research' | 'projects' | 'about';

export interface NavigationItem {
  id: RouteId;
  index: string;
  label: string;
}

export interface Experience {
  period: string;
  role: string;
  organization: string;
  kind: string;
  summary: string;
  highlights: string[];
  tools: string[];
}

export interface Project {
  index: string;
  title: string;
  kicker: string;
  summary: string;
  proof: string;
  tools: string[];
  link?: string;
}

export const navigation: NavigationItem[] = [
  { id: 'start', index: '00', label: 'Start' },
  { id: 'experience', index: '01', label: 'Experience' },
  { id: 'research', index: '02', label: 'Research' },
  { id: 'projects', index: '03', label: 'Projects' },
  { id: 'about', index: '04', label: 'About' },
];

export const routeTitles: Record<RouteId, string> = {
  start: 'Harsh Dave — Software, data & research',
  experience: 'Experience — Harsh Dave',
  research: 'Research — Harsh Dave',
  projects: 'Projects — Harsh Dave',
  about: 'About — Harsh Dave',
};

export const proofPoints = [
  { value: '2× B.S.', label: 'Computer Science + Statistics' },
  { value: 'Summa', label: 'Cum Laude' },
  { value: 'M.S. 2028', label: 'Computer Science, in progress' },
  { value: 'Research', label: 'Computational genomics' },
];

export const experiences: Experience[] = [
  {
    period: 'Jun 2026 — Now',
    role: 'Research Assistant, Computational Genomics',
    organization: 'Ioerger Lab · Texas A&M University',
    kind: 'Research',
    summary:
      'Building reproducible computational workflows that study evolutionary selection in Mycobacterium tuberculosis and turn large genomic analyses into clear, inspectable scientific outputs.',
    highlights: [
      'Develop Python and Slurm pipelines for genome-wide Bayesian selection analysis on Texas A&M high-performance computing systems.',
      'Translate model outputs into publication-ready tables, figures, and biology-first explanations.',
      'Collaborate with Dr. Thomas Ioerger on a computational genomics manuscript in preparation.',
    ],
    tools: ['Python', 'Slurm', 'Bayesian MCMC', 'PAML', 'HPC'],
  },
  {
    period: 'Aug — Dec 2025',
    role: 'Software Engineering Capstone',
    organization: 'Amazon-sponsored · Texas A&M University',
    kind: 'Applied AI',
    summary:
      'Built a breach-intelligence platform with a three-person team, connecting automated data ingestion, AI-assisted processing, search, and analyst-facing exploration.',
    highlights: [
      'Designed a multi-system pipeline spanning AWS storage, document databases, search, caching, and graph relationships.',
      'Integrated AI-assisted enrichment while keeping the workflow inspectable for analysts.',
    ],
    tools: ['Python', 'AWS', 'LangChain', 'Elasticsearch', 'MongoDB'],
  },
  {
    period: '2025 — 2026',
    role: 'Teaching Assistant, CS 111',
    organization: 'Texas A&M University',
    kind: 'Teaching',
    summary:
      'Supported students learning Java and object-oriented programming by turning abstract concepts, debugging patterns, and assignment feedback into practical next steps.',
    highlights: [
      'Guided more than 23 students each week through Java, object-oriented programming, and problem-solving fundamentals.',
      'Reviewed more than 180 weekly submissions while giving actionable, consistent feedback.',
    ],
    tools: ['Java', 'Object-oriented programming', 'Mentorship', 'Code review'],
  },
  {
    period: 'Jan — May 2025',
    role: 'Undergraduate Researcher',
    organization: 'UrbanResilience.AI Lab · Texas A&M University',
    kind: 'Data systems',
    summary:
      'Developed Python data pipelines for air-quality and wildfire-response analysis, bringing together sensor APIs, web data, and predictive modeling.',
    highlights: [
      'Connected environmental sensor data with emergency-response context for Los Angeles-area analysis.',
      'Built reusable scraping and preparation workflows for downstream modeling.',
    ],
    tools: ['Python', 'APIs', 'Web scraping', 'Predictive modeling'],
  },
  {
    period: 'May — Aug 2024',
    role: 'AI Engineering Intern',
    organization: 'Videomagic · Remote',
    kind: 'Product engineering',
    summary:
      'Worked across applied AI and backend systems for video-generation workflows, from model experimentation to authenticated product APIs.',
    highlights: [
      'Applied PyTorch and Hugging Face models to AI video-generation and deepfake-detection workflows.',
      'Built authenticated APIs with Feathers.js, MySQL, Knex, Auth0, and JWT.',
      'Contributed to workflows associated with 20% less manual editing time and 15% higher engagement.',
    ],
    tools: ['PyTorch', 'Hugging Face', 'TypeScript', 'MySQL', 'Auth0'],
  },
  {
    period: 'Jan — May 2022',
    role: 'Cloud Team Research Member',
    organization: 'SpaceCraft VR · College Station, Texas',
    kind: 'Cloud systems',
    summary:
      'Helped an eight-person research team automate cloud infrastructure for simulation work and build a secure React/TypeScript sandbox.',
    highlights: [
      'Improved deployment speed by 25% through cloud infrastructure automation.',
      'Hardened access flows with Auth0, reducing unauthorized access by 30%.',
    ],
    tools: ['React', 'TypeScript', 'Cloud infrastructure', 'Auth0'],
  },
];

export const projects: Project[] = [
  {
    index: '01',
    title: 'Alpha',
    kicker: 'Tidal Hackathon · 1st place',
    summary:
      'An interactive math-learning environment that orchestrates multiple AI and visualization tools so students can move from a question to an explorable explanation.',
    proof: 'Reduced tool-call failure from 25% to 6% while coordinating Gemini, OpenRouter, Claude, Manim, Desmos, and Wolfram Alpha.',
    tools: ['React', 'TypeScript', 'Multi-model AI', 'Visualization'],
  },
  {
    index: '02',
    title: 'Point of Sale System',
    kicker: 'Scrum master + lead developer',
    summary:
      'A full-stack point-of-sale platform covering ordering, inventory, analytics, authentication, APIs, and accessible customer flows.',
    proof: 'Led the team delivery process while building across React, PostgreSQL, AWS, OAuth2, and WCAG 2.1 requirements.',
    tools: ['React', 'PostgreSQL', 'AWS', 'OAuth2', 'Accessibility'],
  },
  {
    index: '03',
    title: 'AI Investigation Challenge',
    kicker: 'TAMU Datathon · 2nd of 50 teams',
    summary:
      'A fast-moving investigation workflow using prompt engineering, web scraping, and reverse prompt engineering to connect incomplete evidence.',
    proof: 'Placed second among 50 teams at TAMU Datathon 2024.',
    tools: ['Prompt engineering', 'Web scraping', 'Evidence synthesis'],
  },
  {
    index: '04',
    title: 'Sign Sense',
    kicker: 'Computer vision + real-time recognition',
    summary:
      'A sign-language recognition experience that connects a YOLOv5 vision model with a Svelte product interface and FastAPI backend.',
    proof: 'Built with AWS SageMaker, Svelte, and FastAPI around a YOLOv5 recognition workflow.',
    tools: ['YOLOv5', 'SageMaker', 'Svelte', 'FastAPI'],
  },
  {
    index: '05',
    title: 'ProfFinder',
    kicker: 'Course planning, made legible',
    summary:
      'A course-section search and scheduling tool backed by a custom database assembled from Texas A&M course data.',
    proof: 'Combined SQL, JavaScript, HTML/CSS, and data collection into one practical student tool.',
    tools: ['SQL', 'JavaScript', 'Data pipelines', 'Product design'],
  },
];

export const skillGroups = [
  {
    label: 'Build',
    items: ['Python', 'Java', 'C++', 'TypeScript', 'JavaScript', 'SQL', 'R', 'React', 'FastAPI'],
  },
  {
    label: 'Model',
    items: ['PyTorch', 'Hugging Face', 'LangChain', 'NumPy', 'SciPy', 'pandas', 'Statistical modeling'],
  },
  {
    label: 'Ship',
    items: ['AWS', 'PostgreSQL', 'MongoDB', 'Elasticsearch', 'Docker', 'Git', 'Linux'],
  },
  {
    label: 'Research',
    items: ['Slurm', 'HPRC', 'GenomegaMap', 'PAML', 'dN/dS', 'MCMC', 'FASTA pipelines'],
  },
];
