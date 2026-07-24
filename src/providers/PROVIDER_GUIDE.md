# Provider guide

Last reviewed: **2026-07-24**

This guide describes what each provider is _likely_ to return so users can
choose sources intelligently. It is based on the provider implementations,
the live resolver results in [`PROVIDER_AUDIT.md`](../../PROVIDER_AUDIT.md),
and the web sources listed below.

> [!IMPORTANT]
> A provider is an aggregator, not a licensed catalog. Availability, audio
> tracks, subtitles, domains, and resolution vary by title and can change
> without notice. A listed language means that the provider commonly carries
> it or labels it in its response; it is **not a guarantee for every stream**.
> `Auto` means an adaptive/master stream whose exact resolution is selected by
> the player.

## Language key

- 🇬🇧 `EN` — English
- 🇮🇳 `HI / TA / TE / ML / BN` — Hindi / Tamil / Telugu / Malayalam / Bengali
- 🇫🇷 `FR` — French
- 🇮🇹 `IT` — Italian
- 🇪🇸 `ES` — Spanish
- 🇵🇹 `PT` — Portuguese
- 🇻🇳 `VI` — Vietnamese
- 🌐 `Original / Multi` — original-language or multiple audio tracks; inspect
  the stream label before playing

## Current providers

| Provider ID       | Best suited to                                                           | Expected stream audio                                                                  | Quality users may see                                                                               | Evidence / caveat                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `4khdhub`         | Indian films and series, Hollywood/international dubs                    | 🇮🇳 HI, TA, TE; 🇬🇧 EN; sometimes 🌐 Multi                                               | Resolution may be unlabeled; catalog advertises 1080p and 2160p                                     | The resolver returned many links but did not report their resolution. Check the release name for audio.                                                                              |
| `4khdhubnew`      | Same catalog as 4KHDHub, with stronger release parsing                   | 🇮🇳 HI, TA, TE; 🇬🇧 EN; 🌐 Multi                                                         | **2160p, 1080p** observed; HDR/DV/REMUX may appear in release labels                                | Best current Indian/multilingual choice when image quality matters.                                                                                                                  |
| `bollyflix`       | Bollywood, South Indian cinema, Hindi-dubbed Hollywood, web series       | 🇮🇳 HI commonly; 🇬🇧 EN; regional or dual audio varies                                   | Quality was unlabeled in the audit; web catalog commonly lists 480p/720p/1080p and occasional 2160p | The implementation consumes a relay, so the source site's advertised tiers are not guaranteed to reach this resolver.                                                                |
| `castle`          | Broad international and Indian movies/series; regional dubs              | 🌐 Per-title tracks; commonly 🇬🇧 EN and 🇮🇳 HI, TA, TE, ML                              | **480p, 720p, 1080p** observed                                                                      | The implementation explicitly requests every audio track exposed by Castle and includes the track language in the server name.                                                       |
| `dahmermovies`    | Broad movie and TV file library, including large releases                | 🇬🇧 EN, 🌐 original, or Multi Audio when the filename says HIN/TAM/TEL/Multi/Dual       | **1080p, 2160p/4K, REMUX** observed                                                                 | Strong quality, but language is inferred from filenames. “Original” is title-dependent and does not always mean English.                                                             |
| `dahmermovies-tv` | Broad movie/episode directory fallback                                   | Mostly 🇬🇧 EN or 🌐 original; filename-dependent                                        | **1080p, 2160p** observed                                                                           | This variant does not expose a reliable audio-language label; use it for quality/coverage, not language certainty.                                                                   |
| `movieblast`      | Bollywood, Telugu/Tamil cinema, international movies and series          | 🇮🇳 HI, TA, TE; 🇬🇧 EN; other regional tracks may occur                                  | **360p, 720p** observed by this resolver                                                            | Third-party web pages advertise higher tiers, but only the audited resolver result is documented here.                                                                               |
| `movix`           | Francophone-localized international movies and series                    | 🇫🇷 FR commonly; 🇬🇧 EN may be available                                                 | Resolution currently unlabeled/unknown                                                              | The implementation uses the French `fr-FR` catalog and rotating Movix API domains.                                                                                                   |
| `netmirror`       | Mirrored OTT-style Indian and international catalogs                     | Commonly 🇬🇧 EN and 🇮🇳 HI, TA, TE; additional tracks vary                               | **360p, 480p, 1080p** observed                                                                      | Good multilingual choice. The numbered domain rotates; the implementation currently uses `net27.cc`.                                                                                 |
| `notorrent`       | International movies/series, including Spanish-localized results         | 🇬🇧 EN, 🇪🇸 ES, or title-dependent 🌐 original                                           | **Auto / unknown** observed                                                                         | Audio is inferred from a parenthesized language in the result title. Despite its name, this is an HTTP stream aggregator.                                                            |
| `peachify`        | Broad international and Indian coverage through several upstreams        | 🇬🇧 EN, 🇮🇳 HI, TA, TE, 🇵🇹 PT may occur                                                  | **HD** observed; source can also return explicit 360p–2160p labels                                  | The upstream response has audio/language fields, but the current provider does not copy them into the user-visible server label. Treat language as uncertain until that is improved. |
| `playimdb`        | Bollywood/South Asian and international fallback                         | Mainly 🇬🇧 EN and 🇮🇳 HI                                                                 | **1080p** observed                                                                                  | Filename-based quality; audio is not explicitly surfaced by the provider.                                                                                                            |
| `purstream`       | Francophone movies and series, including international titles            | 🇫🇷 FR commonly; 🇬🇧 EN may be available                                                 | Resolution currently unlabeled/unknown                                                              | Search is forced to `fr-FR`; this is the most clearly French-targeted current provider.                                                                                              |
| `showbox`         | Broad international movie/TV catalog via FebBox-style files              | Usually 🇬🇧 EN or 🌐 original; versions may vary                                        | Parser supports 360p–2160p/4K and ORG, but **no final stream resolved in the audit**                | Requires working cookies/upstream access. Do not select it solely for a promised quality tier until it returns a validated link.                                                     |
| `streamflix`      | Broad international movies and TV                                        | Mostly 🇬🇧 EN or 🌐 original; audio is not labeled                                      | **720p, 1080p** observed                                                                            | “Premium” endpoints are labeled 1080p and standard/fallback endpoints 720p.                                                                                                          |
| `tamilian`        | Tamil movies, including Tamil-dubbed regional/international films        | 🇮🇳 TA primarily; occasional dubbed content from other origins                          | **1080p** observed                                                                                  | **Movies only** in this implementation; TV always returns no result.                                                                                                                 |
| `uhdmovies`       | High-bitrate Indian and international movie/TV releases                  | Often 🇬🇧 EN, 🇮🇳 HI, or dual audio, but the resolver does not reliably expose the track | **2160p/4K, 1080p**, HEVC/x265, HDR/DV, BluRay/WEB-DL labels observed                               | Excellent image-quality source. Verify the release filename before assuming its audio language.                                                                                      |
| `videasy`         | Broad international movie/TV multi-server fallback                       | Usually 🇬🇧 EN or 🌐 original; audio is not explicitly returned                         | **Auto** or explicit **360p–2160p** when the upstream labels it                                     | Rich multilingual subtitle support is separate from audio. Do not infer spoken language from subtitle flags.                                                                         |
| `videasy2`        | Alternative VidEasy/VidKing multi-server path                            | Usually 🇬🇧 EN or 🌐 original; audio is not explicitly returned                         | **Auto** or explicit **360p–2160p** when available                                                  | Independent API path using Oxygen/Hydrogen/Lithium servers; useful when `videasy` fails.                                                                                             |
| `vidfast`         | Broad international movies and TV                                        | Primarily 🇬🇧 EN or 🌐 original                                                         | **Auto, 720p, 1080p** observed                                                                      | Adaptive HLS variants are parsed into their actual resolutions. The player supports subtitle selection, which does not imply alternate audio.                                        |
| `vidlink`         | Broad international movies and TV                                        | Primarily 🇬🇧 EN; upstream-dependent 🌐 original possible                               | **360p, 480p, 720p, 1080p** observed                                                                | The clearest current English-labeled fallback; subtitle tracks can be multilingual.                                                                                                  |
| `vidsrc`          | Broad international movie/TV fallback from several hosts                 | Primarily 🇬🇧 EN or 🌐 original                                                         | Resolution may be **360p–1080p**, but audit result was unlabeled                                    | The implementation parses HLS variants when available; extraction is host-sensitive and was only partially successful in the audit.                                                  |
| `vidzee`          | Broad international multi-server catalog                                 | Advertises 🇬🇧 EN, 🇻🇳 VI and 🇮🇳 HI, BN, TA, TE, ML sources                              | Advertises **1080p and 4K**; audit reached only an embed locator, not a final stream                | Treat both language and quality as unverified until this resolver produces a validated final URL.                                                                                    |
| `vixsrc`          | Broad international movies and TV with Italian localization              | 🇬🇧 EN and 🇮🇹 IT; 🌐 original may vary                                                  | “Best available” HLS quality; exact audited resolution was unlabeled                                | VixSrc documents an audio preference parameter for Italian. This implementation does not currently request a preferred language.                                                     |
| `xpass`           | Indian and international movies/series, often dubbed                     | 🇬🇧 EN and 🇮🇳 HI commonly                                                               | **Auto, 268p, 360p, 536p, 720p, 804p** observed                                                     | Useful language/coverage fallback, but its nonstandard resolutions and uneven ceiling make it a weaker quality-first choice.                                                         |
| `kisskh`          | Korean, Chinese, Japanese, Thai, Taiwanese and wider Asian dramas/movies | Original Asian audio; English subtitles commonly available                             | **Auto / HD** observed                                                                              | Primary Asian-drama provider. TMDB seasons are mapped when Kisskh uses absolute episode numbering.                                                                                   |
| `dramafull`       | Asian dramas and films, especially Korean/Chinese/Japanese/Thai titles   | Original Asian audio; English subtitles commonly available                             | Source-reported quality, commonly HD                                                                | Additional K-drama fallback. It had no tested match in the July audit, so expect less reliable coverage than Kisskh.                                                                 |
| `toonhub`         | Anime, cartoons and animated films/series                                | 🇬🇧 EN, 🇮🇳 HI and Japanese; dual/multi-audio releases                                   | **480p, 720p, 1080p and HD** observed                                                               | Language is derived from filenames when possible. The provider also tries ToonStream when ToonHub has too few links.                                                                 |
| `cuevana`         | International movies and series localized for Spain and Latin America    | 🇪🇸 Castilian Spanish and Latin-American Spanish                                        | Upstream-dependent; audited final streams had unlabeled resolution                                  | Resolves Cuevana player entries and supported external hosts into media URLs. Availability varies heavily by host.                                                                   |
| `jetfilmizle`     | Turkish-localized and international films and series                     | 🇹🇷 Turkish and 🇬🇧 English tracks on supported series; dubbed/subtitled movie variants  | **360p–1080p** observed on the current adaptive TV player; movie quality is release-dependent       | The site moved to `jetfilmizle.now` after the audit. The provider supports its current movie pages and season/episode player.                                                        |

## Quick choices

- Best chance of 4K: `4khdhubnew`, `dahmermovies`, `dahmermovies-tv`,
  `uhdmovies`.
- Best Indian/multilingual coverage: `4khdhubnew`, `netmirror`, `castle`,
  `movieblast`, `tamilian` (Tamil movies only).
- Best French choice: `purstream`, then `movix`.
- Best Italian-aware choice: `vixsrc`.
- Best general English HD fallbacks: `streamflix`, `vidlink`, `vidfast`.
- Most uncertain today: `showbox` and `vidzee`, because the audit did not
  resolve a final playable URL.

## Recommended next integrations

All seven P0 providers from the audit are integrated. Several regional
recommendations below are now integrated as well; they remain listed to record
the rationale for the expansion.

1. **Kisskh** — now integrated. Korean, Chinese, Japanese, Thai,
   Taiwanese and wider Asian drama/film in original audio with English
   subtitles; **HD/Auto observed** in both tested implementations. Add first if
   Asian drama matters to the product.
2. **Anime-Sama** — still not integrated. French anime coverage with Japanese audio + French
   subtitles (`VOSTFR`) and French dub (`VF`). It is distinct from every
   current provider and was observed working in HD.
3. **ToonHub** — now integrated. Anime and cartoons with English/Hindi audio; **480p, 720p,
   1080p and HD observed**. This is the strongest next choice for Indian anime
   users.
4. **Spanish providers: Cuevana is now integrated; VerHdLink or HomeCine remain alternatives** —
   Latin-American/Castilian Spanish coverage is nearly absent from the current
   set. All three resolved streams in WebStreamrMBG, though exact resolution
   was not reported. Implement only one initially to avoid redundant
   maintenance.
5. **A German provider: KinoGer first, then MeineCloud/Filmpalast** — KinoGer
   produced the most final links of the tested German sources (11), followed
   by MeineCloud (8) and Filmpalast (7). Exact resolutions were not reported.
6. **JetFilmizle** — now integrated for movies and series. Turkish-dubbed/localized international and Turkish
   content. It resolved `Auto` streams and fills a language gap, but the audit
   evidence is thinner than the choices above.
7. **Kokoshka** — Albanian subtitles/dub and 14 resolved links in the
   WebStreamr test. A valuable niche integration if Albanian localization is
   part of the intended audience.

Lower priority for now:

- `Frembed` or `FrenchCloud` can expand French redundancy, but `purstream` and
  `movix` already cover that language.
- `AnimeSalt` and `AnimeWorld` are viable Hindi/English/Japanese anime
  alternatives, but ToonHub has clearer observed resolution coverage.
- Do not start with P3/P4 entries such as `MostraGuarda`, `GramCinema`,
  `Myflixer-extractor`, or other sources that returned no final locator or have
  a known packaging/configuration defect.

## Web checks

These pages were used as catalog/language corroboration; live resolver quality
still comes from the local audit:

- [4KHDHub catalog](https://4khdhub.one/) — Indian/international releases,
  language tags, 1080p/2160p, HDR/DV/REMUX labels.
- [Tamilian](https://tamilian.io/) — Tamil-focused catalog and stated
  720p/1080p availability.
- [BollyFlix catalog example](https://bollyflix.fund/) — Hindi/English and
  regional dual-audio release labels.
- [VixSrc documentation](https://vixsrc.to/) — movies/TV, catalog size,
  highest-available quality claim, and preferred Italian audio parameter.
- [VidFast documentation](https://vidfast.vc/) — movies/TV and adaptive
  high-quality streaming.
- [VidZee documentation](https://vidzee.wtf/) — movies/TV and advertised
  1080p/4K availability.
- [NetMirror overview](https://netmirrors.net.in/) — OTT-style catalog,
  Hindi/Tamil/Telugu audio and Full HD claim.
- [Castle overview](https://www.castleapp.co.in/) — international/Indian
  catalog, regional languages, 720p/1080p tiers.
- [MovieBlast overview](https://movieblast.net/about-us/) — movies in Hindi,
  English, Tamil, Telugu and other languages.
- [Purstream](https://purstream.com.cv/) — French-focused movies and series.
- [Anime-Sama catalog](https://anime-sama.tv/catalogue/) — anime/film catalog
  with `VF` and `VOSTFR` language labels.
- [Kisskh overview](https://www.kisskhweb.com/) — Asian drama/movie catalog,
  original regional audio and English subtitles in HD.
- [JetFilmizle](https://jetfilmizle.now/) — current Turkish movie/series
  domain, Turkish dub/subtitle categories, and language-localized catalog.
