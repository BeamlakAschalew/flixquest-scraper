/**
 * Point-in-time content and audio-language coverage from the universal
 * provider audit. Categories are listed in audit order. The value is plain
 * text so API clients do not need to decode emoji symbols.
 */
export const PROVIDER_CONTENT_BADGES: Readonly<Record<string, string>> = {
  cineby: 'Hollywood',
  cinejoy: 'Hollywood, Anime',
  aether: 'Hollywood, Anime',
  videasy: 'Hollywood, Anime',
  showbox: 'Hollywood, Anime',
  '4khdhub':
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  '4khdhubnew':
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  uhdmovies:
    'Hollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  streamflix: 'Hollywood, Bollywood',
  notorrent: '',
  vidlink:
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown',
  netmirror: 'Hollywood: audio unknown | Spanish: audio unknown',
  vidfast:
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: Korean, English | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  castle:
    'Hollywood: Tamil, Hindi | Indian/Bollywood: Tamil | Korean: Hindi, Tamil | Anime: audio unknown | Turkish: Korean, Tamil | Spanish: Tamil | French: audio unknown | Animation: audio unknown',
  movieblast:
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Spanish: audio unknown | Animation: audio unknown',
  peachify: '',
  movix:
    'Hollywood: French, English | Indian/Bollywood: French, English | Korean: French, Korean, English | Anime: Japanese, French | Turkish: audio unknown | Spanish: French, English | French: French, English | Animation: French, English',
  purstream:
    'Hollywood: French, English | Indian/Bollywood: French, Japanese | Korean: French, Korean, English, Japanese | Anime: Japanese, French | Turkish: audio unknown | Spanish: French, English | French: French, English | Animation: French, English',
  cuevana:
    'Hollywood: Spanish, Latin American Spanish | Indian/Bollywood: Latin American Spanish, Spanish | Korean: Latin American Spanish, Spanish | Anime: Latin American Spanish, Spanish | Turkish: Latin American Spanish, Spanish | Animation: Latin American Spanish, Spanish',
  vixsrc: '',
  vidsrc:
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  vidzee:
    'Hollywood: English, Hindi | Indian/Bollywood: Hindi, English | Korean: Hindi | Anime: Hindi | Turkish: Hindi, English | Spanish: Hindi | French: Hindi | Animation: Hindi, English',
  dahmermovies: '',
  'dahmermovies-tv': '',
  videasy2: '',
  bollyflix: '',
  playimdb:
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  tamilian:
    'Hollywood: Tamil | Indian/Bollywood: audio unknown | Turkish: audio unknown | Spanish: audio unknown',
  xpass:
    'Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  kisskh: 'Korean',
  dramafull: '',
  toonhub:
    'Hollywood: English, Hindi, Japanese | Korean: English, Hindi, Japanese | Anime: English, Hindi, Japanese | French: English, Hindi, Japanese | Animation: English, Hindi',
  jetfilmizle:
    'Hollywood: Turkish, English | Indian/Bollywood: Turkish | Korean: Turkish | Anime: Turkish, English, Japanese | Turkish: Turkish, English | Spanish: Turkish, English, Spanish | French: Turkish',
  artemis: '',
  watchflux: '',
  vidrock:
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  vidnest:
    'Hollywood: English | Indian/Bollywood: English | Korean: English | Anime: English | Turkish: English | Spanish: English, Spanish | French: English | Animation: English',
  vidup:
    'Hollywood: audio unknown | Indian/Bollywood: audio unknown | Korean: audio unknown | Anime: audio unknown | Turkish: audio unknown | Spanish: audio unknown | French: audio unknown | Animation: audio unknown',
  goated: 'Hollywood: audio unknown | Animation: audio unknown',
  bingr: 'Hollywood: Hindi/Multi, original',
  rive: 'Hollywood: original, Hindi | TV: original, Hindi, Vietnamese',
  vidrift: 'Hollywood: original audio',
  vuflix:
    'Hollywood: English, original, Hindi | TV: English, original, Hindi | Optional German audio',
  cinevaro:
    'Hollywood: original audio | TV: original audio | Adaptive quality varies by title',
  fsharetv:
    'Hollywood: original audio | Movies only | Explicit quality files vary by title',
  vyla: 'Hollywood: original audio | TV: original audio | MP4/HLS quality varies by title',
  yoturkish: 'Turkish: Turkish audio | TV series | English subtitles',
  movy: 'Hollywood, Anime',
  shuttletv: 'Hollywood, Anime',
  coreflix:
    'Hollywood: original audio | Movies and TV | Multiple independent VidCore servers',
}
