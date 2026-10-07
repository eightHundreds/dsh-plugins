import * as monaco from 'monaco-editor/editor/editor.api.js'

// Import all Monaco basic language definitions
import 'monaco-editor/languages/definitions/abap/register.js'
import 'monaco-editor/languages/definitions/apex/register.js'
import 'monaco-editor/languages/definitions/azcli/register.js'
import 'monaco-editor/languages/definitions/bat/register.js'
import 'monaco-editor/languages/definitions/bicep/register.js'
import 'monaco-editor/languages/definitions/cameligo/register.js'
import 'monaco-editor/languages/definitions/clojure/register.js'
import 'monaco-editor/languages/definitions/coffee/register.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/definitions/csharp/register.js'
import 'monaco-editor/languages/definitions/csp/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/cypher/register.js'
import 'monaco-editor/languages/definitions/dart/register.js'
import 'monaco-editor/languages/definitions/dockerfile/register.js'
import 'monaco-editor/languages/definitions/ecl/register.js'
import 'monaco-editor/languages/definitions/elixir/register.js'
import 'monaco-editor/languages/definitions/flow9/register.js'
import 'monaco-editor/languages/definitions/freemarker2/register.js'
import 'monaco-editor/languages/definitions/fsharp/register.js'
import 'monaco-editor/languages/definitions/go/register.js'
import 'monaco-editor/languages/definitions/graphql/register.js'
import 'monaco-editor/languages/definitions/handlebars/register.js'
import 'monaco-editor/languages/definitions/hcl/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/ini/register.js'
import 'monaco-editor/languages/definitions/java/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/julia/register.js'
import 'monaco-editor/languages/definitions/kotlin/register.js'
import 'monaco-editor/languages/definitions/less/register.js'
import 'monaco-editor/languages/definitions/lexon/register.js'
import 'monaco-editor/languages/definitions/liquid/register.js'
import 'monaco-editor/languages/definitions/lua/register.js'
import 'monaco-editor/languages/definitions/m3/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import 'monaco-editor/languages/definitions/mdx/register.js'
import 'monaco-editor/languages/definitions/mips/register.js'
import 'monaco-editor/languages/definitions/msdax/register.js'
import 'monaco-editor/languages/definitions/mysql/register.js'
import 'monaco-editor/languages/definitions/objective-c/register.js'
import 'monaco-editor/languages/definitions/pascal/register.js'
import 'monaco-editor/languages/definitions/pascaligo/register.js'
import 'monaco-editor/languages/definitions/perl/register.js'
import 'monaco-editor/languages/definitions/pgsql/register.js'
import 'monaco-editor/languages/definitions/php/register.js'
import 'monaco-editor/languages/definitions/pla/register.js'
import 'monaco-editor/languages/definitions/postiats/register.js'
import 'monaco-editor/languages/definitions/powerquery/register.js'
import 'monaco-editor/languages/definitions/powershell/register.js'
import 'monaco-editor/languages/definitions/protobuf/register.js'
import 'monaco-editor/languages/definitions/pug/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/qsharp/register.js'
import 'monaco-editor/languages/definitions/r/register.js'
import 'monaco-editor/languages/definitions/razor/register.js'
import 'monaco-editor/languages/definitions/redis/register.js'
import 'monaco-editor/languages/definitions/redshift/register.js'
import 'monaco-editor/languages/definitions/restructuredtext/register.js'
import 'monaco-editor/languages/definitions/ruby/register.js'
import 'monaco-editor/languages/definitions/rust/register.js'
import 'monaco-editor/languages/definitions/sb/register.js'
import 'monaco-editor/languages/definitions/scala/register.js'
import 'monaco-editor/languages/definitions/scheme/register.js'
import 'monaco-editor/languages/definitions/scss/register.js'
import 'monaco-editor/languages/definitions/shell/register.js'
import 'monaco-editor/languages/definitions/solidity/register.js'
import 'monaco-editor/languages/definitions/sophia/register.js'
import 'monaco-editor/languages/definitions/sparql/register.js'
import 'monaco-editor/languages/definitions/sql/register.js'
import 'monaco-editor/languages/definitions/st/register.js'
import 'monaco-editor/languages/definitions/swift/register.js'
import 'monaco-editor/languages/definitions/systemverilog/register.js'
import 'monaco-editor/languages/definitions/tcl/register.js'
import 'monaco-editor/languages/definitions/twig/register.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/typespec/register.js'
import 'monaco-editor/languages/definitions/vb/register.js'
import 'monaco-editor/languages/definitions/wgsl/register.js'
import 'monaco-editor/languages/definitions/xml/register.js'
import 'monaco-editor/languages/definitions/yaml/register.js'

// @ts-expect-error monaco-editor exports tokenization.js without d.ts
import { createTokenizationSupport } from 'monaco-editor/languages/features/json/tokenization.js'

monaco.languages.register({
  id: 'json',
  extensions: ['.json', '.jsonc', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc', '.har'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json'],
})

monaco.languages.setTokensProvider('json', createTokenizationSupport(true))

/** Extension (lowercase without dot) to Monaco language ID */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  abap: 'abap',
  cls: 'apex',
  azcli: 'azcli',
  bat: 'bat',
  cmd: 'bat',
  bicep: 'bicep',
  mligo: 'cameligo',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',
  coffee: 'coffeescript',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  csx: 'csharp',
  cake: 'csharp',
  csp: 'csp',
  css: 'css',
  cypher: 'cypher',
  cyp: 'cypher',
  dart: 'dart',
  dockerfile: 'dockerfile',
  ecl: 'ecl',
  ex: 'elixir',
  exs: 'elixir',
  flow: 'flow9',
  ftl: 'freemarker2',
  ftlh: 'freemarker2',
  ftlx: 'freemarker2',
  fs: 'fsharp',
  fsi: 'fsharp',
  ml: 'fsharp',
  mli: 'fsharp',
  fsx: 'fsharp',
  fsscript: 'fsharp',
  go: 'go',
  graphql: 'graphql',
  gql: 'graphql',
  handlebars: 'handlebars',
  hbs: 'handlebars',
  tf: 'hcl',
  tfvars: 'hcl',
  hcl: 'hcl',
  html: 'html',
  htm: 'html',
  shtml: 'html',
  xhtml: 'html',
  mdoc: 'html',
  jsp: 'html',
  asp: 'html',
  aspx: 'html',
  jshtm: 'html',
  ini: 'ini',
  properties: 'ini',
  gitconfig: 'ini',
  java: 'java',
  jav: 'java',
  js: 'javascript',
  es6: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jl: 'julia',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lex: 'lexon',
  liquid: 'liquid',
  'html.liquid': 'liquid',
  lua: 'lua',
  m3: 'm3',
  i3: 'm3',
  mg: 'm3',
  ig: 'm3',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkdn: 'markdown',
  mkd: 'markdown',
  mdwn: 'markdown',
  mdtxt: 'markdown',
  mdtext: 'markdown',
  mdx: 'mdx',
  s: 'mips',
  dax: 'msdax',
  msdax: 'msdax',
  m: 'objective-c',
  pas: 'pascal',
  p: 'pascal',
  pp: 'ruby',
  ligo: 'pascaligo',
  pl: 'perl',
  pm: 'perl',
  php: 'php',
  php4: 'php',
  php5: 'php',
  phtml: 'php',
  ctp: 'php',
  pla: 'pla',
  dats: 'postiats',
  sats: 'postiats',
  hats: 'postiats',
  pq: 'powerquery',
  pqm: 'powerquery',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  proto: 'proto',
  jade: 'pug',
  pug: 'pug',
  py: 'python',
  rpy: 'python',
  pyw: 'python',
  cpy: 'python',
  gyp: 'python',
  gypi: 'python',
  qs: 'qsharp',
  r: 'r',
  rhistory: 'r',
  rmd: 'r',
  rprofile: 'r',
  rt: 'r',
  cshtml: 'razor',
  redis: 'redis',
  rst: 'restructuredtext',
  rb: 'ruby',
  rbx: 'ruby',
  rjs: 'ruby',
  gemspec: 'ruby',
  rs: 'rust',
  rlib: 'rust',
  sb: 'sb',
  scala: 'scala',
  sc: 'scala',
  sbt: 'scala',
  scm: 'scheme',
  ss: 'scheme',
  sch: 'scheme',
  rkt: 'scheme',
  scss: 'scss',
  sh: 'shell',
  bash: 'shell',
  sol: 'sol',
  aes: 'aes',
  rq: 'sparql',
  sql: 'sql',
  st: 'st',
  iecst: 'st',
  iecplc: 'st',
  lc3lib: 'st',
  tcpou: 'st',
  tcdut: 'st',
  tcgvl: 'st',
  tcio: 'st',
  sv: 'systemverilog',
  svh: 'systemverilog',
  v: 'verilog',
  vh: 'verilog',
  tcl: 'tcl',
  twig: 'twig',
  ts: 'typescript',
  tsx: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  tsp: 'typespec',
  vb: 'vb',
  wgsl: 'wgsl',
  xml: 'xml',
  xsd: 'xml',
  dtd: 'xml',
  ascx: 'xml',
  csproj: 'xml',
  config: 'xml',
  props: 'xml',
  targets: 'xml',
  wxi: 'xml',
  wxl: 'xml',
  wxs: 'xml',
  xaml: 'xml',
  svg: 'xml',
  svgz: 'xml',
  opf: 'xml',
  xslt: 'xml',
  xsl: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  jsonc: 'json',
  zsh: 'shell',
  env: 'ini',
  toml: 'ini',
}

/** Supported extensions list for DocumentPreview registration */
export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_TO_LANGUAGE)

/** Resolve Monaco language id from resource pathname */
export function getLanguageForPath(pathname: string): string {
  const slash = Math.max(pathname.lastIndexOf('/'), pathname.lastIndexOf('\\'))
  const base = pathname.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  if (dot >= 0) {
    const ext = base.slice(dot + 1).toLowerCase()
    const lang = EXTENSION_TO_LANGUAGE[ext]
    if (lang) return lang
  }
  return 'plaintext'
}
