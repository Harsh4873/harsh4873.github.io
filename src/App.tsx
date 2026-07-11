import {
  ArrowRight,
  ArrowUpRight,
  Atom,
  BookOpen,
  Braces,
  BrainCircuit,
  CircleDot,
  Code2,
  Github,
  GraduationCap,
  Layers3,
  Mail,
  MapPin,
  Microscope,
  Printer,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  experiences,
  navigation,
  projects,
  proofPoints,
  skillGroups,
  type Experience,
  type Project,
  type RouteId,
} from './content';
import { routeHref, useRoute } from './useRoute';

const EMAIL = 'hdav3228@gmail.com';

function AtlasMark() {
  return (
    <svg className="atlas-mark" viewBox="0 0 54 54" aria-hidden="true">
      <circle cx="27" cy="27" r="23" />
      <path d="M9 27h36M27 9c8 8 8 28 0 36M27 9c-8 8-8 28 0 36" />
      <circle className="atlas-mark-dot" cx="36" cy="19" r="3.5" />
    </svg>
  );
}

function SiteHeader({ route }: { route: RouteId }) {
  return (
    <header className="site-header">
      <a className="identity-link" href={routeHref('start')} aria-label="Harsh Dave, home">
        <AtlasMark />
        <span>
          <strong>Harsh Dave</strong>
          <small>CS · Statistics · Research</small>
        </span>
      </a>

      <nav className="primary-nav" aria-label="Portfolio sections">
        {navigation.map((item) => (
          <a
            className={item.id === route ? 'nav-link active' : 'nav-link'}
            href={routeHref(item.id)}
            aria-current={item.id === route ? 'page' : undefined}
            key={item.id}
          >
            <span>{item.index}</span>
            {item.label}
          </a>
        ))}
      </nav>

      <a className="header-contact" href={'mailto:' + EMAIL}>
        Let&apos;s talk
        <ArrowUpRight aria-hidden="true" />
      </a>
    </header>
  );
}

function RouteLink({ route, children, className }: { route: RouteId; children: ReactNode; className?: string }) {
  return (
    <a href={routeHref(route)} className={className}>
      {children}
    </a>
  );
}

function ThreadDiagram() {
  return (
    <svg className="thread-diagram" viewBox="0 0 520 390" role="img" aria-labelledby="thread-title thread-desc">
      <title id="thread-title">Harsh&apos;s areas of practice</title>
      <desc id="thread-desc">A line connects software, data, and biology around a central question.</desc>
      <path className="thread-path thread-shadow" d="M60 260C85 98 200 75 258 184s124 150 208 36" />
      <path className="thread-path" d="M60 260C85 98 200 75 258 184s124 150 208 36" />
      <g className="thread-node node-code">
        <circle cx="79" cy="205" r="34" />
        <text x="79" y="210">CODE</text>
      </g>
      <g className="thread-node node-data">
        <circle cx="250" cy="171" r="38" />
        <text x="250" y="176">DATA</text>
      </g>
      <g className="thread-node node-bio">
        <circle cx="420" cy="251" r="34" />
        <text x="420" y="256">BIO</text>
      </g>
      <g className="question-node">
        <circle cx="264" cy="284" r="56" />
        <text x="264" y="278">BETTER</text>
        <text x="264" y="298">QUESTIONS</text>
      </g>
      <path className="question-line" d="M264 228v-24" />
      <circle className="orbit-dot orbit-one" cx="133" cy="117" r="7" />
      <circle className="orbit-dot orbit-two" cx="460" cy="204" r="7" />
      <text className="diagram-note" x="48" y="337">ONE THREAD / MANY DISCIPLINES</text>
    </svg>
  );
}

function ProofRibbon() {
  return (
    <section className="proof-ribbon" aria-label="Education and current focus">
      {proofPoints.map((point, index) => (
        <article key={point.value}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong>{point.value}</strong>
          <p>{point.label}</p>
        </article>
      ))}
    </section>
  );
}

function StartPage() {
  const disciplines = [
    {
      route: 'experience' as const,
      number: '01',
      title: 'Software, end to end',
      copy: 'From an unfinished question to a system people can actually use.',
      icon: Code2,
    },
    {
      route: 'research' as const,
      number: '02',
      title: 'Evidence, not theater',
      copy: 'Reproducible analysis, explicit uncertainty, and results that stay inspectable.',
      icon: Microscope,
    },
    {
      route: 'projects' as const,
      number: '03',
      title: 'Curiosity in public',
      copy: 'Hackathons and side projects where new tools meet practical constraints.',
      icon: Sparkles,
    },
  ];

  return (
    <>
      <section className="start-hero" aria-labelledby="start-heading">
        <div className="hero-copy">
          <p className="eyebrow"><span>Portfolio / 2026</span> College Station, Texas</p>
          <h1 id="start-heading">
            <span>Build systems.</span>
            <em>Find signal.</em>
            <span>Explain why.</span>
          </h1>
          <p className="hero-lede">
            I&apos;m Harsh—computer scientist, statistician, and computational genomics researcher building reliable software at the intersection of AI, data, and biology.
          </p>
          <div className="hero-actions">
            <RouteLink route="projects" className="button button-primary">
              Explore the work <ArrowRight aria-hidden="true" />
            </RouteLink>
            <a className="button button-quiet" href={'mailto:' + EMAIL}>
              <Mail aria-hidden="true" /> Say hello
            </a>
          </div>
        </div>

        <aside className="hero-atlas" aria-label="Current coordinates">
          <div className="atlas-label">
            <span>Current coordinates</span>
            <CircleDot aria-hidden="true" />
          </div>
          <ThreadDiagram />
          <div className="now-note">
            <span>Now</span>
            <p>Pursuing M.S. Computer Science, Expected 2028, while researching computational genomics in the Ioerger Lab.</p>
          </div>
        </aside>
      </section>

      <ProofRibbon />

      <section className="discipline-section" aria-labelledby="discipline-heading">
        <div className="section-intro">
          <p className="chapter-label">The through line</p>
          <h2 id="discipline-heading">Different disciplines.<br />One standard of care.</h2>
          <p>I like hard problems that reward both technical depth and a clear explanation of what matters.</p>
        </div>

        <div className="discipline-list">
          {disciplines.map(({ route, number, title, copy, icon: Icon }) => (
            <RouteLink route={route} className="discipline-row" key={route}>
              <span className="discipline-number">{number}</span>
              <Icon aria-hidden="true" />
              <span className="discipline-copy">
                <strong>{title}</strong>
                <small>{copy}</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </RouteLink>
          ))}
        </div>
      </section>

      <section className="contact-band">
        <p>Have an interesting system, dataset, or research question?</p>
        <a href={'mailto:' + EMAIL}>Let&apos;s compare notes <ArrowUpRight aria-hidden="true" /></a>
      </section>
    </>
  );
}

function PageHeading({ chapter, title, lede, aside }: { chapter: string; title: string; lede: string; aside: string }) {
  return (
    <header className="page-heading">
      <p className="chapter-label">{chapter}</p>
      <div>
        <h1>{title}</h1>
        <p>{lede}</p>
      </div>
      <p className="heading-aside">{aside}</p>
    </header>
  );
}

function ExperienceEntry({ experience, index }: { experience: Experience; index: number }) {
  return (
    <article className="experience-entry">
      <div className="experience-rail">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <i aria-hidden="true" />
      </div>
      <div className="experience-meta">
        <p>{experience.period}</p>
        <span>{experience.kind}</span>
      </div>
      <div className="experience-body">
        <p className="organization">{experience.organization}</p>
        <h2>{experience.role}</h2>
        <p className="experience-summary">{experience.summary}</p>
        <ul>
          {experience.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
        </ul>
        <div className="tool-line" aria-label="Tools and methods">
          {experience.tools.map((tool) => <span key={tool}>{tool}</span>)}
        </div>
      </div>
    </article>
  );
}

function ExperiencePage() {
  return (
    <>
      <PageHeading
        chapter="01 / Experience"
        title="Work that crosses boundaries."
        lede="My best work lives between disciplines: software with scientific rigor, research with production discipline, and AI grounded in the problem it is meant to solve."
        aside="A selected chronology · 2022—Now"
      />
      <section className="experience-list" aria-label="Selected experience">
        {experiences.map((experience, index) => (
          <ExperienceEntry experience={experience} index={index} key={experience.role + experience.organization} />
        ))}
      </section>
      <section className="next-chapter">
        <span>Next chapter</span>
        <RouteLink route="research">Inside the research <ArrowRight aria-hidden="true" /></RouteLink>
      </section>
    </>
  );
}

function ResearchPage() {
  const methods = ['Genome-wide analysis', 'Bayesian MCMC', 'dN/dS', 'Python pipelines', 'Slurm arrays', 'PAML', 'Statistical validation', 'Scientific writing'];

  return (
    <>
      <section className="research-hero" aria-labelledby="research-heading">
        <div className="research-title-block">
          <p className="chapter-label light">02 / Research</p>
          <span className="research-status"><i aria-hidden="true" /> Active · Ioerger Lab</span>
          <h1 id="research-heading">When genomes change,<br /><em>what is the signal?</em></h1>
          <p>
            I build computational workflows to study evidence of evolutionary selection in <i>Mycobacterium tuberculosis</i>—and to make the path from sequence data to scientific interpretation reproducible.
          </p>
        </div>
        <div className="sequence-field" aria-hidden="true">
          <span>ATG CCG TTA GAC</span><span>GGT AAC CTC TGA</span><span>CTA GGC <b>A</b>AT CCG</span><span>TAC GGA TTC AAC</span><span>GCA TTA CCG GAT</span><span>AAC TCG GTA CTA</span><span>CCG ATC TTA GGC</span>
        </div>
      </section>

      <section className="research-framework" aria-label="Research approach">
        <article>
          <span>01 / Question</span>
          <BrainCircuit aria-hidden="true" />
          <h2>Start with the contrast.</h2>
          <p>Define a biological comparison that can be tested with sequence evidence, then make assumptions and uncertainty explicit.</p>
        </article>
        <article>
          <span>02 / System</span>
          <TerminalSquare aria-hidden="true" />
          <h2>Build for repeatability.</h2>
          <p>Automate filtering, compute, post-processing, statistics, and artifact generation so the result can be rebuilt—not merely remembered.</p>
        </article>
        <article>
          <span>03 / Story</span>
          <BookOpen aria-hidden="true" />
          <h2>Translate without flattening.</h2>
          <p>Turn technical output into tables, figures, and prose that preserve nuance while helping a biology-first audience see the evidence.</p>
        </article>
      </section>

      <section className="methods-band" aria-label="Research methods">
        <p>Methods in motion</p>
        <div>
          {methods.map((method) => <span key={method}>{method}</span>)}
        </div>
      </section>

      <section className="research-detail">
        <div className="research-detail-heading">
          <p className="chapter-label">Current work</p>
          <h2>A pipeline is also an argument.</h2>
        </div>
        <div className="research-detail-copy">
          <p>
            Every step—from cohort definition and reference alignment to posterior comparison and validation—shapes what a result can honestly say. My job is to make those steps inspectable and the final evidence useful.
          </p>
          <div className="manuscript-note">
            <Atom aria-hidden="true" />
            <span>
              <strong>Manuscript in preparation</strong>
              Computational genomics research with Dr. Thomas Ioerger at Texas A&M University.
            </span>
          </div>
        </div>
      </section>
      <section className="next-chapter dark-next">
        <span>Next chapter</span>
        <RouteLink route="projects">Selected projects <ArrowRight aria-hidden="true" /></RouteLink>
      </section>
    </>
  );
}

function ProjectRow({ project, featured = false }: { project: Project; featured?: boolean }) {
  const content = (
    <>
      <span className="project-index">{project.index}</span>
      <div className="project-title">
        <p>{project.kicker}</p>
        <h2>{project.title}</h2>
      </div>
      <div className="project-story">
        <p>{project.summary}</p>
        <strong>{project.proof}</strong>
        <div className="tool-line">
          {project.tools.map((tool) => <span key={tool}>{tool}</span>)}
        </div>
      </div>
      {project.link ? <ArrowUpRight className="project-arrow" aria-hidden="true" /> : <ArrowRight className="project-arrow" aria-hidden="true" />}
    </>
  );

  if (project.link) {
    return <a className={featured ? 'project-row featured' : 'project-row'} href={project.link} target="_blank" rel="noreferrer">{content}<span className="sr-only"> (opens Devpost in a new tab)</span></a>;
  }

  return <article className={featured ? 'project-row featured' : 'project-row'}>{content}</article>;
}

function ProjectsPage() {
  return (
    <>
      <PageHeading
        chapter="03 / Projects"
        title="Proof through making."
        lede="These projects are where I test ideas quickly, make tradeoffs visible, and learn which parts of a system deserve the most care."
        aside="Selected builds · AI, data, full stack"
      />
      <section className="project-list" aria-label="Selected projects">
        {projects.map((project, index) => <ProjectRow project={project} featured={index === 0} key={project.title} />)}
      </section>
      <div className="project-links">
        <a href="https://github.com/Harsh4873" target="_blank" rel="noreferrer"><Github aria-hidden="true" /> More code on GitHub <ArrowUpRight aria-hidden="true" /></a>
        <a href="https://devpost.com/hdav3228" target="_blank" rel="noreferrer"><Sparkles aria-hidden="true" /> Hackathons on Devpost <ArrowUpRight aria-hidden="true" /></a>
      </div>
      <section className="next-chapter">
        <span>Next chapter</span>
        <RouteLink route="about">Education, tools & interests <ArrowRight aria-hidden="true" /></RouteLink>
      </section>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <PageHeading
        chapter="04 / About"
        title="Two lenses are better than one."
        lede="Computer science taught me how to build. Statistics taught me how to ask whether the result is trustworthy. Research keeps both instincts honest."
        aside="Harsh Dave · College Station, Texas"
      />

      <section className="education-record" aria-labelledby="education-heading">
        <div className="education-seal"><GraduationCap aria-hidden="true" /><span>TAMU</span></div>
        <div>
          <p className="chapter-label">Education</p>
          <h2 id="education-heading">Texas A&amp;M University</h2>
          <p>Dual B.S. degrees in Computer Science and Statistics · May 2026 · <strong>Summa Cum Laude</strong></p>
          <p className="masters-line">Pursuing M.S. Computer Science, Expected 2028</p>
        </div>
        <span className="education-place"><MapPin aria-hidden="true" /> College Station, TX</span>
      </section>

      <section className="skills-section" aria-labelledby="skills-heading">
        <div className="skills-heading">
          <p className="chapter-label">Working vocabulary</p>
          <h2 id="skills-heading">Tools follow the question.</h2>
          <p>I care more about choosing the right abstraction than collecting logos. These are the tools I reach for most often.</p>
        </div>
        <div className="skill-groups">
          {skillGroups.map((group, index) => (
            <article key={group.label}>
              <span>{String(index + 1).padStart(2, '0')} / {group.label}</span>
              <p>{group.items.join(' · ')}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-grid">
        <article className="principles-panel">
          <p className="chapter-label">What I optimize for</p>
          <ul>
            <li><Braces aria-hidden="true" /><span><strong>Legibility</strong>Complex systems should still explain themselves.</span></li>
            <li><Layers3 aria-hidden="true" /><span><strong>Reproducibility</strong>A result is stronger when someone else can rebuild it.</span></li>
            <li><BrainCircuit aria-hidden="true" /><span><strong>Useful curiosity</strong>Explore widely, then turn the insight into something practical.</span></li>
          </ul>
        </article>
        <article className="offscreen-panel">
          <p className="chapter-label light">Away from the keyboard</p>
          <h2>Movement, competition, and a good side quest.</h2>
          <p>Away from the keyboard, I make time for strength training and team sports. Hackathons are my favorite kind of side quest: a reason to make something real before every answer is obvious.</p>
          <a href="https://harsh.bet/gym/">Visit the training log <ArrowUpRight aria-hidden="true" /></a>
        </article>
      </section>

      <section className="contact-card">
        <div>
          <p className="chapter-label light">Open line</p>
          <h2>Let&apos;s build something worth explaining.</h2>
        </div>
        <div className="contact-actions">
          <a href={'mailto:' + EMAIL}><Mail aria-hidden="true" /> {EMAIL}</a>
          <a href="https://github.com/Harsh4873" target="_blank" rel="noreferrer"><Github aria-hidden="true" /> GitHub <ArrowUpRight aria-hidden="true" /></a>
          <button type="button" onClick={() => window.print()}><Printer aria-hidden="true" /> Print portfolio</button>
        </div>
      </section>
    </>
  );
}

function CurrentPage({ route }: { route: RouteId }) {
  if (route === 'experience') return <ExperiencePage />;
  if (route === 'research') return <ResearchPage />;
  if (route === 'projects') return <ProjectsPage />;
  if (route === 'about') return <AboutPage />;
  return <StartPage />;
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div><AtlasMark /><span><strong>Harsh Dave</strong><small>Built with care in College Station.</small></span></div>
      <p>Software · Data · Research</p>
      <div className="footer-links">
        <a href={'mailto:' + EMAIL}>Email</a>
        <a href="https://github.com/Harsh4873" target="_blank" rel="noreferrer">GitHub</a>
        <a href="https://devpost.com/hdav3228" target="_blank" rel="noreferrer">Devpost</a>
      </div>
    </footer>
  );
}

export default function App() {
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    mainRef.current?.focus({ preventScroll: true });
  }, [route]);

  return (
    <div className={'site-shell route-' + route}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteHeader route={route} />
      <main id="main-content" className="page-content" tabIndex={-1} ref={mainRef} key={route}>
        <CurrentPage route={route} />
      </main>
      <SiteFooter />
    </div>
  );
}
