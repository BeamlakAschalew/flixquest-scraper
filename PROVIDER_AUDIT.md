# Provider audit — 2026-07-19

## Outcome

I exercised every manifest provider in `nuviotr`, `nuvio-providers`, `NuvioRepo`, and `All-in-One-Nuvio`, plus the two unregistered provider scripts under `nuviotr/providers`. The Nuvio collections contain 119 manifest entries and two unregistered scripts (121 total). Across the two main rounds, 371 provider/title calls were made; targeted compatibility and corrected-Arabic-ID reruns brought the total to 382.

At resolver level, **42 of 121 Nuvio entries returned at least one valid HTTP(S) or magnet locator**. Four entries have concrete packaging/interface defects. The remaining 75 loaded but returned no valid locator for the relevant two-to-four-title matrix and are therefore **inconclusive/no tested match**, not proven dead.

WebStreamrMBG built successfully and the supplied TMDB v4 Read Access Token authenticated correctly with **no TMDB 401 responses**. Of its 21 sources, **12 resolved final streams**, 2 reached embed-locator stage without a final URL, 5 returned no tested match, and 2 produced repeatable runtime/upstream errors.

## Test matrix and method

- General: Fight Club (movie 550), Oppenheimer (movie 872585), Breaking Bad (TV 1396 S1E1), Game of Thrones (TV 1399 S1E1).
- Turkish: Miracle in Cell No. 7 (movie 637920), Recep Ivedik 5 (movie 438703), The Protector (TV 79026 S1E1), Ezel (TV 32519 S1E1).
- Arabic: The Blue Elephant (movie 289510), The Blue Elephant 2 (movie 599672), Al Hayba (TV 84299 S1E1), The Assassins (TV 224882 S1E1).
- Anime/Korean: Spirited Away (129), Your Name (372058), One Piece (37854), Naruto (46260), Parasite (496243), Squid Game (93405), The 8th Night (845783), Queen of Tears (215720).
- Indian/Tamil: Leo (949229), RRR (579974), Suzhal (200861), Sacred Games (79352). Cartoons: Inside Out (150540), Soul (508442), Rick and Morty (60625), Gravity Falls (40075).

Each supported media type received a relevant first-round ID. Providers with no first-round success received an alternate ID. Calls used a 15-second per-fetch cap and a 40-second total provider-call cap. Third-party Nuvio scripts ran in a restricted VM with no real environment, no workspace/filesystem access, no supplied TMDB credential, and an import allowlist. The v4 token was supplied only to the trusted WebStreamrMBG process environment and was not written to this report or any repository file.

“Working” means the provider resolved at least one syntactically valid stream locator. It does **not** mean the entire video was played to completion. “No tested match” can mean a dead upstream, geo/rate blocking, catalog miss, required provider settings, or a parser regression; retest in Nuvio’s Hermes Plugin Tester before removal.

## Nuvio collection summary

| Collection | Entries tested | Working | No tested match | Concrete broken/incompatible |
|---|---:|---:|---:|---:|
| nuviotr | 20 | 6 | 12 | 2 |
| nuvio-providers | 30 | 4 | 24 | 2 |
| NuvioRepo | 10 | 2 | 8 | 0 |
| All-in-One-Nuvio | 61 | 30 | 31 | 0 |
| **Total** | **121** | **42** | **75** | **4** |

## Combined provider catalog and implementation priority

This is the cross-folder view: matching provider IDs are one row, while the **Copies** column preserves where each implementation lives. It contains **115 normalized provider identities** across the four Nuvio collections and WebStreamrMBG. Stream language/localization and content origin are intentionally separate. Language values come from manifests, source country tags, provider code, and targeted web checks; they describe catalog tendency, not a guarantee for every returned file. Homepage notes distinguish web-verified sites from code-declared, rotating, API-only, or unavailable public pages.

Quality is resolver-level evidence from this audit: **A** = observed 2160p/4K; **B** = observed HD/720p/1080p; **C** = a final locator resolved but its resolution was unknown/Auto, indirect, or magnet-based; **D** = no final locator, partial extraction, error, or a concrete defect. This does not verify bitrate, codec correctness, audio tracks, subtitle sync, uptime, geo-access, or full playback.

Priority means: **P0** implement first (observed 4K/HD or unusually strong multi-result coverage, plus broad value); **P1** high-value regional or strong HD source; **P2** fallback/optional because quality is unknown, indirect, fragile, or substantially overlaps stronger sources; **P3** investigate/retest before implementation; **P4** do not implement until a known defect, error, or required private configuration is fixed. A unique regional source can rank P1 even with grade C because language coverage is part of implementation value.

| P0 | P1 | P2 | P3 | P4 |
|---:|---:|---:|---:|---:|
| 7 | 26 | 16 | 61 | 5 |

Recommended first implementation wave: `4khdhub`, `Dahmermovies`, `Streamflix`, `Uhdmovies`, `Videasy`, `4KHDHub-NEW`, `Dahmermovies-TV`. Implement the P1 regional sources next by the languages your product intends to support, rather than treating P1 as a single global ordering.

### Turkish-localized

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| AltiYuzAltmisAltiFilm | nuviotr | [666filmizle.site](https://666filmizle.site/) — code-declared | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| DiziYou | nuviotr | [www.diziyou.one](https://www.diziyou.one/) — web-verified | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| FilmModu | nuviotr | [www.filmmodu.ws](https://www.filmmodu.ws/) — code-declared | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| FullHdFilmizlesene | nuviotr | [www.fullhdfilmizlesene.live](https://www.fullhdfilmizlesene.live/) — web-verified | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| JetFilmizle | nuviotr | [jetfilmizle.net](https://jetfilmizle.net/) — web/code-verified | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | Working in nuviotr. observed Auto | C | P1 |
| M3u | nuviotr | — playlist aggregator; no standalone homepage | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| MoOnCrOwN M3U | nuviotr | — missing local target; no resolvable homepage | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. packaging/interface defect or no working copy | D | P4 |
| MoOnCrOwNDiziM3U | nuviotr | — playlist aggregator; no standalone homepage | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | Working in nuviotr. observed powerboard, Zerk | C | P2 |
| MoOnCrOwNFilmM3U | nuviotr | — playlist aggregator; no standalone homepage | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | Working in nuviotr. observed Zerk, Lunedor | C | P2 |
| MoonVidmodyFilmDizi | nuviotr | [vidmody.com](https://vidmody.com/) — code-declared playback site | English, Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | Working in nuviotr. observed Auto | C | P2 |
| M3U List (unregistered) | nuviotr | — unregistered playlist script; no standalone homepage | Turkish; sometimes English/original audio | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. packaging/interface defect or no working copy | D | P4 |
| Rec | nuviotr | [a.prectv70.lol](https://a.prectv70.lol/) — code-declared | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| SezonlukDizi | nuviotr | [sezonlukdizi8.com](https://sezonlukdizi8.com/) — code-declared | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| SinemaCx | nuviotr | [www.sinema.la](https://www.sinema.la/) — current code domain; manifest branding is SinemaCX | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| SineWix | nuviotr | [ydfvfdizipanel.ru](https://ydfvfdizipanel.ru/) — API endpoint; no public catalog homepage | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |
| WebteIzle | nuviotr | [webteizle3.xyz](https://webteizle3.xyz/) — code-declared | Turkish | Mostly Hollywood/international and Turkish TV/film, localized for Turkey | No working copy in this test. no final locator in the tested matrix | D | P3 |

### Arabic-targeted / mixed MENA

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| Cineby | All-in-One-Nuvio | [player.videasy.to](https://player.videasy.to/) — provider delegates playback to Videasy | Arabic, English | International/Hollywood plus mixed Indian, Turkish and Arabic catalog; Arabic support is declared, not observed | No working copy in this test. no final locator in the tested matrix | D | P3 |
| CinemaCity | nuviotr, All-in-One-Nuvio | [cinemacity.cc](https://cinemacity.cc/) — code-declared | Arabic, English, Hindi, Turkish | International/Hollywood plus mixed Indian, Turkish and Arabic catalog; Arabic support is declared, not observed | No working copy in this test. no final locator in the tested matrix | D | P3 |

### Indian / South Asian

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| 4khdhub | nuvio-providers, All-in-One-Nuvio, WebStreamrMBG | [4khdhub.fans](https://4khdhub.fans/) — web-verified; implementation also rotates domains | Hindi, Tamil, Telugu, English; some Japanese/Korean and multilingual releases | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio, WebStreamrMBG. 61 final WebStreamr resolutions; resolution not reported | C | P0 |
| 4KHDHub-NEW | All-in-One-Nuvio | [4khdhub.fans](https://4khdhub.fans/) — web-verified catalog; code copy uses the same service | Hindi, Tamil, Telugu, English; multilingual releases | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. observed 2160p, 1080p | A | P0 |
| AllMovieLand | All-in-One-Nuvio | [allmovieland.you](https://allmovieland.you/) — code-declared; unusual/rotating domain | English, Hindi, Tamil, Telugu | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| BollyFlix | All-in-One-Nuvio | — provider uses an addon/API relay; no source homepage exposed | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P1 |
| CineFreak | All-in-One-Nuvio | [cinefreak.nl](https://cinefreak.nl/) — code-declared | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| CTGMovies | All-in-One-Nuvio | [ctgmovies.com](https://ctgmovies.com/) — code-declared | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |
| Einthustan | All-in-One-Nuvio | [einthusan.tv](https://einthusan.tv/) — code-declared | Hindi, Tamil, Telugu, Bengali, Malayalam, Kannada, Punjabi, Marathi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| GramCinema | All-in-One-Nuvio | [bollywood.eu.org](https://bollywood.eu.org/) — code-declared; provider-token gated | English, Hindi, Russian, Tamil | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P4 |
| HDGharTV | All-in-One-Nuvio | — no stable public homepage exposed in code | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Hdhub4u | nuvio-providers, All-in-One-Nuvio, WebStreamrMBG | [new1.hdhub4u.limo](https://new1.hdhub4u.limo/) — active code base; domains rotate | Hindi, Gujarati, Malayalam, Punjabi, Tamil, Telugu, English/multilingual | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| HindMoviez | All-in-One-Nuvio | — provider exposes link hosts, not a stable source homepage | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Isaidub | NuvioRepo | [isaidub.love](https://isaidub.love/) — code-declared; web evidence confirms Tamil-dub focus | Tamil dub; some English originals | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Mallumv | nuvio-providers | [mallumv.fit](https://mallumv.fit/) — code-declared | English | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| MovieBlast | All-in-One-Nuvio | [app.cloud-mb.xyz](https://app.cloud-mb.xyz/) — API endpoint; no public catalog homepage | English, Hindi, Tamil, Telugu | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. observed 720p, 360p | B | P1 |
| Moviebox | nuvio-providers, All-in-One-Nuvio, WebStreamrMBG | [moviebox.ph](https://moviebox.ph/) — code-declared public site | English, Hindi, Tamil, Telugu | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio; another copy has a concrete defect; WebStreamr copy errored. valid locator(s), resolution not reported | C | P2 |
| Movies4u | NuvioRepo, All-in-One-Nuvio | [movies4u.fans](https://movies4u.fans/) — code-declared; also uses m4uplay.com | English, Hindi, Tamil | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Moviesda | NuvioRepo | [moviesda15.com](https://moviesda15.com/) — code-declared | English, Tamil | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| MoviesDrive | All-in-One-Nuvio | — no stable public homepage exposed in code | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| 🎬 MoviesHunt | All-in-One-Nuvio | [movieshunt.run](https://movieshunt.run/) — code-declared | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |
| Moviesmod | nuvio-providers, All-in-One-Nuvio | [moviesmod.chat](https://moviesmod.chat/) — code-declared; domains rotate | English | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| NetMirror | nuviotr, nuvio-providers, All-in-One-Nuvio | [net22.cc](https://net22.cc/) — code-declared; numbered domains rotate | English, Hindi, Tamil, Telugu | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. observed 360p, 480p, 1080p | B | P1 |
| 🍑 Peachify | All-in-One-Nuvio | — API/host resolver; no public homepage exposed | English, Hindi, Portuguese, Tamil, Telugu | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. observed HD | B | P1 |
| PlayIMDb | All-in-One-Nuvio | [streamdata.vaplayer.ru](https://streamdata.vaplayer.ru/) — API endpoint; no public catalog homepage | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. observed 1080p | B | P1 |
| Tamilblasters | NuvioRepo | [www.1tamilblasters.business](https://www.1tamilblasters.business/) — code-declared; domains rotate | Tamil, Telugu, Hindi, Malayalam, English | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Tamilian | NuvioRepo | [tamilian.io](https://tamilian.io/) — code-declared | English, Tamil | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in NuvioRepo. observed 1080p | B | P1 |
| TamilMV | NuvioRepo | [www.1tamilmv.lc](https://www.1tamilmv.lc/) — code-declared; domains rotate | Tamil, Telugu, Malayalam, Hindi, English | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| ToonHub | NuvioRepo | [toonhub4u.co](https://toonhub4u.co/) — code-declared | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in NuvioRepo. observed HD, 720p, 1080p, 480p | B | P1 |
| Uhdmovies | nuvio-providers, All-in-One-Nuvio | [uhdmovies.email](https://uhdmovies.email/) — code-declared | English | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. observed 4K \| x265/HEVC, 1080p \| BluRay \| x265/HEVC, 4K \| WEB-DL \| x265/HEVC | A | P0 |
| VegaMovies | All-in-One-Nuvio | — provider currently exposes a file host, not a stable catalog homepage | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| XPass | All-in-One-Nuvio | [play.xpass.top](https://play.xpass.top/) — code-declared player | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. observed 268p, 536p, 804p, Auto, 360p, 720p | B | P1 |
| XDmovies | NuvioRepo | [xdmovies.site](https://xdmovies.site/) — code-declared | English, Hindi | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | No working copy in this test. no final locator in the tested matrix | D | P3 |
| ZinkMovies | All-in-One-Nuvio | [zinkmovies.wtf](https://zinkmovies.wtf/) — code-declared | English, Hindi, Tamil, Telugu | Bollywood and South Indian cinema (Kollywood/Tollywood/Mollywood), often with Hollywood/international dubs | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |

### Anime / Japanese animation

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| AllAnime | All-in-One-Nuvio | [allanime.day](https://allanime.day/) — code-declared | English, Japanese | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| 🌟 All-Wish | All-in-One-Nuvio | [megaplay.buzz](https://megaplay.buzz/) — code-declared playback host | English, Japanese | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| AniDB | All-in-One-Nuvio | — no distinct public homepage found in provider code; not assumed to be AniDB.net | English, Japanese, Korean | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| AnikotoTV | All-in-One-Nuvio | [anikototv.to](https://anikototv.to/) — manifest-declared | English, Japanese | Japanese anime; some providers also carry Western cartoons | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |
| 🐍 Anime-Sama | All-in-One-Nuvio | [anime-sama.to](https://anime-sama.to/) — web-verified current catalog; domains rotate | French dub (VF), Japanese with French subtitles (VOSTFR) | Japanese anime; some providers also carry Western cartoons | Working in All-in-One-Nuvio. observed 1080p, 720p, 480p | B | P1 |
| Animekai | nuvio-providers, All-in-One-Nuvio | [animekai.to](https://animekai.to/) — code-declared | English | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Animelok | NuvioRepo | [animelok.online](https://animelok.online/) — web-verified successor domain; code references animelok.to | Hindi, Tamil, Telugu, Malayalam, English, Japanese | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| AnimePahe | All-in-One-Nuvio | [animepahe.com](https://animepahe.com/) — code-declared; web evidence confirms English-sub catalog | English, Japanese | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| 🧂 AnimeSalt | All-in-One-Nuvio | [animesalt.ac](https://animesalt.ac/) — manifest-declared | English, Hindi, Japanese | Japanese anime; some providers also carry Western cartoons | Working in All-in-One-Nuvio. observed 720p | B | P1 |
| Animetsu | All-in-One-Nuvio | [animetsu.live](https://animetsu.live/) — code-declared | English, Japanese | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| 🗡️ AnimeWorld | All-in-One-Nuvio | [watchanimeworld.net](https://watchanimeworld.net/) — manifest-declared | English, Hindi, Japanese | Japanese anime; some providers also carry Western cartoons | Working in All-in-One-Nuvio. observed 1080p | B | P1 |
| FibWatch | All-in-One-Nuvio | — no stable public homepage exposed in code | English, Hindi | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| HiAnime | All-in-One-Nuvio | [hianime.tv](https://hianime.tv/) — code-declared | English, Japanese | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Kurage | All-in-One-Nuvio | [kurage.live](https://kurage.live/) — code-declared | English, Japanese | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |
| TopCartoons | All-in-One-Nuvio | [ww.topcartoons.tv](https://ww.topcartoons.tv/) — observed source host | English | Japanese anime; some providers also carry Western cartoons | Working in All-in-One-Nuvio. observed Unknown | C | P2 |
| Vidnest-anime | nuvio-providers | [vidnest.fun](https://vidnest.fun/) — code-declared | English | Japanese anime; some providers also carry Western cartoons | No working copy in this test. no final locator in the tested matrix | D | P3 |

### East / Southeast Asian drama

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| DramaFull | NuvioRepo | [dramafull.cc](https://dramafull.cc/) — code-declared | Korean, Chinese, Japanese; typically English subtitles | Korean, Chinese, Japanese, Thai and wider Asian drama/film | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Kisskh | nuvio-providers, All-in-One-Nuvio | [kisskh.ovh](https://kisskh.ovh/) — code-declared; web evidence confirms Asian-drama focus | English subtitles; Korean, Chinese, Japanese, Thai and other Asian audio | Korean, Chinese, Japanese, Thai and wider Asian drama/film | Working in nuvio-providers, All-in-One-Nuvio. observed Auto, HD | B | P1 |
| 🫰 OnlyKDrama | All-in-One-Nuvio | [onlykdrama.top](https://onlykdrama.top/) — manifest-declared | Korean; subtitle language not verified | Korean, Chinese, Japanese, Thai and wider Asian drama/film | No working copy in this test. no final locator in the tested matrix | D | P3 |

### Spanish-localized

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| CineHDPlus | WebStreamrMBG | [cinehdplus.zone](https://cinehdplus.zone/) — code-declared; web search found a rotating .org mirror | Latin-American Spanish, Castilian Spanish | Mostly Hollywood/international film and TV localized for Spain/Latin America; some Spanish/Latin-American originals | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Cuevana | WebStreamrMBG | [ww1.cuevana3.is](https://ww1.cuevana3.is/) — code-declared; Cuevana has many unrelated clones | Latin-American Spanish, Castilian Spanish, Spanish subtitles | Mostly Hollywood/international film and TV localized for Spain/Latin America; some Spanish/Latin-American originals | Working in WebStreamrMBG. 27 final WebStreamr resolutions; resolution not reported | C | P1 |
| DooFlix | All-in-One-Nuvio | — no stable public homepage exposed in code | English, Spanish | Mostly Hollywood/international film and TV localized for Spain/Latin America; some Spanish/Latin-American originals | No working copy in this test. no final locator in the tested matrix | D | P3 |
| HomeCine | WebStreamrMBG | [www3.homecine.to](https://www3.homecine.to/) — code-declared | Latin-American Spanish, Castilian Spanish | Mostly Hollywood/international film and TV localized for Spain/Latin America; some Spanish/Latin-American originals | Working in WebStreamrMBG. 10 final WebStreamr resolutions; resolution not reported | C | P1 |
| NoTorrent | All-in-One-Nuvio | — aggregator/API sources; no single homepage | English, Spanish | Mostly Hollywood/international film and TV localized for Spain/Latin America; some Spanish/Latin-American originals | Working in All-in-One-Nuvio. observed Auto, Unknown | C | P2 |
| VerHdLink | WebStreamrMBG | [verhdlink.cam](https://verhdlink.cam/) — code-declared | Latin-American Spanish, Castilian Spanish | Mostly Hollywood/international film and TV localized for Spain/Latin America; some Spanish/Latin-American originals | Working in WebStreamrMBG. 12 final WebStreamr resolutions; resolution not reported | C | P1 |

### French-localized

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| Frembed | WebStreamrMBG | [frembed.cyou](https://frembed.cyou/) — code-declared | French dub/localization | Mostly Hollywood/international film and TV localized for Francophone viewers; some French originals | Working in WebStreamrMBG. 12 final WebStreamr resolutions; resolution not reported | C | P1 |
| FrenchCloud | WebStreamrMBG | [frenchcloud.cam](https://frenchcloud.cam/) — code-declared | French dub/localization | Mostly Hollywood/international film and TV localized for Francophone viewers; some French originals | Working in WebStreamrMBG. 5 final WebStreamr resolutions; resolution not reported | C | P1 |
| Movix VF | All-in-One-Nuvio, WebStreamrMBG | [movix.cash](https://movix.cash/) — code-declared public site/API origin | French and English | Mostly Hollywood/international film and TV localized for Francophone viewers; some French originals | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |
| Nakios | All-in-One-Nuvio | — no stable public homepage exposed in code | English, French | Mostly Hollywood/international film and TV localized for Francophone viewers; some French originals | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Purstream | All-in-One-Nuvio | [purstream.art](https://purstream.art/) — manifest-declared; domains rotate | French and English | Mostly Hollywood/international film and TV localized for Francophone viewers; some French originals | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |
| ToFlix | All-in-One-Nuvio | — rotating source plus WaveWatch API; no stable homepage | English, French | Mostly Hollywood/international film and TV localized for Francophone viewers; some French originals | No working copy in this test. no final locator in the tested matrix | D | P3 |

### German-localized

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| Einschalten | WebStreamrMBG | [einschalten.in](https://einschalten.in/) — code-declared | German | Mostly Hollywood/international film and TV localized for German viewers; some German originals | Working in WebStreamrMBG. 1 final WebStreamr resolutions; resolution not reported | C | P2 |
| Filmpalast | WebStreamrMBG | [filmpalast.to](https://filmpalast.to/) — web/code-verified | German dub/localization | Mostly Hollywood/international film and TV localized for German viewers; some German originals | Working in WebStreamrMBG. 7 final WebStreamr resolutions; resolution not reported | C | P1 |
| KinoGer | WebStreamrMBG | [kinoger.com](https://kinoger.com/) — web/code-verified | German dub/localization | Mostly Hollywood/international film and TV localized for German viewers; some German originals | Working in WebStreamrMBG. 11 final WebStreamr resolutions; resolution not reported | C | P1 |
| MegaKino | WebStreamrMBG | [megakino2.biz](https://megakino2.biz/) — code-declared | German dub/localization | Mostly Hollywood/international film and TV localized for German viewers; some German originals | Working in WebStreamrMBG. 4 final WebStreamr resolutions; resolution not reported | C | P1 |
| MeineCloud | WebStreamrMBG | [meinecloud.click](https://meinecloud.click/) — code-declared | German dub/localization | Mostly Hollywood/international film and TV localized for German viewers; some German originals | Working in WebStreamrMBG. 8 final WebStreamr resolutions; resolution not reported | C | P1 |

### Italian-localized

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| Eurostreaming | WebStreamrMBG | [eurostreaming.luxe](https://eurostreaming.luxe/) — code-declared | Italian dub/localization | Mostly Hollywood/international film and TV localized for Italian viewers; some Italian originals | No working copy in this test. no final locator in the tested matrix | D | P3 |
| MostraGuarda | WebStreamrMBG | [mostraguarda.stream](https://mostraguarda.stream/) — code-declared | Italian dub/localization | Mostly Hollywood/international film and TV localized for Italian viewers; some Italian originals | No working copy in this test. repeatable source error; no final URL | D | P4 |

### Albanian-localized

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| Kokoshka | WebStreamrMBG | [kokoshka.digital](https://kokoshka.digital/) — code-declared | Albanian subtitles/dub | Mostly Hollywood/international film and TV localized for Albanian viewers | Working in WebStreamrMBG. 14 final WebStreamr resolutions; resolution not reported | C | P1 |

### International / language-variable

| Provider | Copies | Homepage | Stream language/localization | Content origin/market | Live result and source quality | Grade | Priority |
|---|---|---|---|---|---|:---:|:---:|
| Adimoviebox | nuvio-providers | [moviebox.ph](https://moviebox.ph/) — code-declared public site | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Castle | nuvio-providers, All-in-One-Nuvio | [api.fstcy.com](https://api.fstcy.com/) — API endpoint; no public catalog homepage exposed | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in All-in-One-Nuvio. observed 1080P, 720P, 480P | B | P1 |
| CineMM | All-in-One-Nuvio | [cinemm.com](https://cinemm.com/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Cinevibe | nuvio-providers | [cinevibe.asia](https://cinevibe.asia/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Dahmermovies | nuvio-providers, All-in-One-Nuvio | [a.111477.xyz](https://a.111477.xyz/) — API/host endpoint; no conventional homepage | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in nuvio-providers, All-in-One-Nuvio. observed 2160p, 1080p \| REMUX, 1080p | A | P0 |
| Dahmermovies-TV | All-in-One-Nuvio | [a.111477.xyz](https://a.111477.xyz/) — API/host endpoint; no conventional homepage | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in All-in-One-Nuvio. observed 2160p, 1080p | A | P0 |
| Dvdplay | nuvio-providers | [dvdplay.skin](https://dvdplay.skin/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| 🐐 GoatAPI | All-in-One-Nuvio | [goatapi.imreallydagoatt.workers.dev](https://goatapi.imreallydagoatt.workers.dev/) — API worker; no public catalog homepage | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Hdrezka | nuvio-providers | [hdrezka.ag](https://hdrezka.ag/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Idlix | nuvio-providers | [tv10.idlixku.com](https://tv10.idlixku.com/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Mapple | nuvio-providers | [mapple.uk](https://mapple.uk/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Myflixer-extractor | nuvio-providers | [watch32.sx](https://watch32.sx/) — extractor target, not a valid provider entry | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. packaging/interface defect or no working copy | D | P4 |
| Showbox | nuvio-providers, All-in-One-Nuvio | [febapi.nuvioapp.space](https://febapi.nuvioapp.space/) — API endpoint; no public catalog homepage | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Streamflix | nuvio-providers | [api.streamflix.app](https://api.streamflix.app/) — API endpoint | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in nuvio-providers. observed 1080p, 720p | B | P0 |
| 🧲 Torrentio | All-in-One-Nuvio | [torrentio.strem.fun](https://torrentio.strem.fun/) — public addon endpoint | English, Hindi | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |
| VidFast | All-in-One-Nuvio | [vidfast.vc](https://vidfast.vc/) — code-declared; manifest mentions vidfast.pro | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in All-in-One-Nuvio. observed Auto, 1080p, 720p | B | P1 |
| Videasy | nuvio-providers, All-in-One-Nuvio | [player.videasy.net](https://player.videasy.net/) — code-declared player/API service | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P0 |
| Vidlink | nuviotr, nuvio-providers, All-in-One-Nuvio | [vidlink.pro](https://vidlink.pro/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in nuviotr, nuvio-providers. observed 720p [EN], 480p [EN], 360p [EN], 1080p [EN], 720p, 480p, 360p, 1080p | B | P1 |
| Vidnest | nuvio-providers | [vidnest.fun](https://vidnest.fun/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Vidrock | nuvio-providers, All-in-One-Nuvio | [vidrock.net](https://vidrock.net/) — code-declared; domains rotate | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Vidsrc | nuvio-providers, All-in-One-Nuvio, WebStreamrMBG | [vidsrc.me](https://vidsrc.me/) — code-declared family; WebStreamr uses vidsrcme.ru | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in All-in-One-Nuvio; WebStreamr extraction is partial. valid locator(s), resolution not reported | C | P2 |
| VidZee | WebStreamrMBG | [player.vidzee.wtf](https://player.vidzee.wtf/) — code-declared player | English, Vietnamese, Hindi, Bengali, Tamil, Telugu, Malayalam; multi-server | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. embed locator only; no final URL | D | P3 |
| Vixsrc | nuvio-providers, All-in-One-Nuvio, WebStreamrMBG | [vixsrc.to](https://vixsrc.to/) — code-declared | English, Italian | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | Working in All-in-One-Nuvio. valid locator(s), resolution not reported | C | P2 |
| Watch32 | nuvio-providers | [watch32.sx](https://watch32.sx/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Xprime | nuvio-providers | [xprime.tv](https://xprime.tv/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |
| Yflix | nuvio-providers | [yflix.to](https://yflix.to/) — code-declared | English | Hollywood/international catalogs; audio/subtitle language varies by title and upstream | No working copy in this test. no final locator in the tested matrix | D | P3 |

## nuviotr

| Provider | Manifest state | Result | Evidence |
|---|---|---|---|
| moonvidmodyfilmdizi | Enabled | ✅ Working | Miracle in Cell No. 7 (TMDB 637920, movie) returned 1 stream. |
| MoOnCrOwNFilmM3U | Disabled | ✅ Working | Miracle in Cell No. 7 (TMDB 637920, movie) returned 2 streams. Manifest-disabled, but callable. |
| MoOnCrOwNDiziM3U | Enabled | ✅ Working | Ezel S1E1 (TMDB 32519, tv) returned 2 streams. |
| m3u | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, tv 79026, movie 438703, tv 32519. |
| m3u.mooncrown.addon | Enabled | ❌ Broken | Manifest target `eklentiler/M3U/ListM3u.js` does not exist. |
| netmirror | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, tv 79026, movie 438703, tv 32519. |
| sinemacx | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, tv 79026, movie 438703, tv 32519. |
| diziyou | Enabled | ⚠️ No tested match | 0 valid streams for tv 79026, tv 32519. |
| fullhdfilmizlesene | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, movie 438703. |
| sinewix | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, tv 79026, movie 438703, tv 32519. |
| rec | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, tv 79026, movie 438703, tv 32519. |
| jetfilmizle | Enabled | ✅ Working | Miracle in Cell No. 7 (TMDB 637920, movie) returned 2 streams. |
| sezonlukdizi | Enabled | ⚠️ No tested match | 0 valid streams for tv 79026, tv 32519. |
| webteizle | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, movie 438703. |
| filmmodu | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, movie 438703. |
| altiyuzaltmisaltifilm | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, movie 438703. |
| cinemacity | Enabled | ⚠️ No tested match | 0 valid streams for movie 637920, tv 79026, movie 438703, tv 32519. |
| vidlink | Enabled | ✅ Working | Miracle in Cell No. 7 (TMDB 637920, movie) returned 3 streams. |
| orphan-m3u-list | Unregistered | ❌ Incompatible interface | Unregistered script returned a non-array/undefined result for all four Turkish cases. |
| orphan-yabanci-vidlink | Unregistered | ✅ Working | Miracle in Cell No. 7 (TMDB 637920, movie) returned 3 streams. Manifest-disabled, but callable. Unregistered file. |

## nuvio-providers

| Provider | Manifest state | Result | Evidence |
|---|---|---|---|
| kisskh | Enabled | ✅ Working | Spirited Away (TMDB 129, movie) returned 1 stream. |
| 4khdhub | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| animekai | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| castle | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| cinevibe | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| dahmermovies | Enabled | ✅ Working | Breaking Bad S1E1 (TMDB 1396, tv) returned 5 streams. |
| dvdplay | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| hdhub4u | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| hdrezka | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| idlix | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| mallumv | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| mapple | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| moviebox | Enabled | ❌ Broken | Manifest target `providers/moviebox.js` does not exist. |
| moviesmod | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| myflixer-extractor | Enabled | ❌ Broken | Manifest points at an extractor-only file; no `getStreams` export after compatibility rerun. |
| netmirror | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| showbox | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| streamflix | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 4 streams. |
| uhdmovies | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| videasy | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| vidlink | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 3 streams. |
| vidnest-anime | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| vidnest | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| vidrock | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| vidsrc | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| vixsrc | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| watch32 | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| xprime | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| yflix | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| adimoviebox | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |

## NuvioRepo

| Provider | Manifest state | Result | Evidence |
|---|---|---|---|
| tamilmv | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, movie 579974. |
| tamilblasters | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| tamilian | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 1 stream. |
| moviesda | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, movie 579974. |
| movies4u | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, movie 579974. |
| isaidub | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| toonhub | Enabled | ✅ Working | One Piece S1E1 (TMDB 37854, tv) returned 4 streams. |
| animelok | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| xdmovies | Enabled | ⚠️ No tested match | Compatibility rerun loaded correctly but returned 0 for TMDB 949229, 200861, 579974, and 79352 (some endpoint timeouts). |
| dramafull | Enabled | ⚠️ No tested match | 0 valid streams for movie 496243, tv 93405, movie 845783, tv 215720. |

## All-in-One-Nuvio

| Provider | Manifest state | Result | Evidence |
|---|---|---|---|
| allanime | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| 4khdhub | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 10 streams. |
| 4khdhubnew | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 6 streams. |
| allwish | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| animekai | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| anikototv | Enabled | ✅ Working | Spirited Away (TMDB 129, movie) returned 2 streams. |
| anidb | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| animepahe | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| animesalt | Enabled | ✅ Working | Spirited Away (TMDB 129, movie) returned 1 stream. |
| animetsu | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| animeworld | Enabled | ✅ Working | Spirited Away (TMDB 129, movie) returned 1 stream. |
| anime-sama | Enabled | ✅ Working | Spirited Away (TMDB 129, movie) returned 10 streams. |
| allmovieland | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| bollyflix | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 7 streams. |
| castle | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 3 streams. |
| Cineby | Enabled | ⚠️ No tested match | 0 streams for Arabic movies 289510/599672 and Arabic TV 84299/224882. |
| cinefreak | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| cinemm | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| cinemacity | Enabled | ⚠️ No tested match | 0 streams for Arabic movies 289510/599672 and Arabic TV 84299/224882. |
| ctgmovies | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 1 stream. |
| dahmermovies | Enabled | ✅ Working | Breaking Bad S1E1 (TMDB 1396, tv) returned 5 streams. |
| dahmermovies-tv | Enabled | ✅ Working | Breaking Bad S1E1 (TMDB 1396, tv) returned 5 streams. |
| dooflix | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| einthusan | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| fibwatch | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| goatapi | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, movie 872585. |
| gramcinema | Enabled | ⚠️ No tested match | 0 streams for Arabic movies 289510/599672 and Arabic TV 84299/224882. GramCinema also requires its own settings token. |
| hdghartv | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| hdhub4u | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| hianime | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| hindmoviez | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| kurage | Enabled | ⚠️ No tested match | 0 valid streams for movie 129, tv 37854, movie 372058, tv 46260. |
| moviebox | Enabled | ✅ Working | RRR (TMDB 579974, movie) returned 2 streams. |
| movieblast | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 1 stream. |
| moviesdrive | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| movieshunt | Enabled | ✅ Working | RRR (TMDB 579974, movie) returned 8 streams. |
| moviesmod | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| movies4u | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, movie 579974. |
| movix | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 1 stream. |
| nakios | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| netmirror | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 3 streams. |
| notorrent | Enabled | ✅ Working | Breaking Bad S1E1 (TMDB 1396, tv) returned 13 streams. |
| peachify | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 6 streams. |
| playimdb | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 4 streams. |
| purstream | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 1 stream. |
| showbox | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| toflix | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| topcartoons | Enabled | ✅ Working | Inside Out (TMDB 150540, movie) returned 1 stream. |
| torrentio | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 5 streams. |
| vidrock | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| uhdmovies | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 6 streams. |
| vegamovies | Enabled | ⚠️ No tested match | 0 valid streams for movie 949229, tv 200861, movie 579974, tv 79352. |
| vidlink | Enabled | ⚠️ No tested match | 0 valid streams for movie 550, tv 1396, movie 872585, tv 1399. |
| videasy | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 11 streams. |
| vidsrc | Enabled | ✅ Working | Game of Thrones S1E1 (TMDB 1399, tv) returned 3 streams. |
| vixsrc | Enabled | ✅ Working | Fight Club (TMDB 550, movie) returned 1 stream. |
| vidfast | Enabled | ✅ Working | Breaking Bad S1E1 (TMDB 1396, tv) returned 5 streams. |
| xpass | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 5 streams. |
| zinkmovies | Enabled | ✅ Working | Leo (TMDB 949229, movie) returned 3 streams. |
| onlykdrama | Enabled | ⚠️ No tested match | 0 valid streams for movie 496243, tv 93405, movie 845783, tv 215720. |
| kisskh | Enabled | ✅ Working | Parasite (TMDB 496243, movie) returned 1 stream. |

## WebStreamrMBG

Build: `npm run build` passed on Node 22.23.1. The v4-token live run used movies Fight Club (550), Oppenheimer (872585), and Leo (949229), plus Breaking Bad (1396), Game of Thrones (1399), and Squid Game (93405), all at S1E1. Every source language and error reporting were enabled.

| Working | Partial | No tested match | Error |
|---:|---:|---:|---:|
| 12 | 2 | 5 | 2 |

| Source | Types | Result | Evidence |
|---|---|---|---|
| 4KHDHub | movie, series | ✅ Working | Game of Thrones S1E1 resolved 20 final streams; 61 across all cases. |
| HDHub4u | movie, series | ⚠️ No tested match | Returned 0 source results across 6 supported test cases. |
| VixSrc | movie, series | ⚠️ No tested match | Returned 0 source results across 6 supported test cases. |
| VidSrc | movie, series | 🟡 Partial | Returned up to 1 embed locator per case, but extraction produced no final playable URL. |
| VidZee | movie, series | 🟡 Partial | Returned up to 2 embed locators per case, but extraction produced no final playable URL. |
| MovieBox | movie, series | ❌ Error | Runtime/upstream error on 6 tested cases; no final streams. |
| Kokoshka | movie, series | ✅ Working | Leo resolved 4 final streams; 14 across all cases. |
| CineHDPlus | series | ⚠️ No tested match | Returned 0 source results across 3 supported test cases. |
| Cuevana | movie, series | ✅ Working | Oppenheimer resolved 13 final streams; 27 across all cases. |
| HomeCine | movie, series | ✅ Working | Fight Club resolved 2 final streams; 10 across all cases. |
| VerHdLink | movie | ✅ Working | Oppenheimer resolved 8 final streams; 12 across all cases. |
| Einschalten | movie | ✅ Working | Oppenheimer resolved 1 final stream; 1 across all cases. Also errored on 2 cases. |
| KinoGer | movie, series | ✅ Working | Oppenheimer resolved 3 final streams; 11 across all cases. |
| MegaKino | movie | ✅ Working | Fight Club resolved 2 final streams; 4 across all cases. |
| MeineCloud | movie | ✅ Working | Fight Club resolved 4 final streams; 8 across all cases. |
| Filmpalast | movie, series | ✅ Working | Fight Club resolved 2 final streams; 7 across all cases. |
| Frembed | movie, series | ✅ Working | Oppenheimer resolved 3 final streams; 12 across all cases. Also errored on 1 case. |
| FrenchCloud | movie | ✅ Working | Oppenheimer resolved 3 final streams; 5 across all cases. |
| Movix | movie, series | ⚠️ No tested match | Returned 0 source results across 6 supported test cases. |
| Eurostreaming | series | ⚠️ No tested match | Returned 0 source results across 3 supported test cases. |
| MostraGuarda | movie | ❌ Error | Runtime/upstream error on 3 tested cases; no final streams. |

The v4 token removed the earlier authentication blocker. “Error” here identifies a source-level failure during the live run; it does not necessarily distinguish a provider parser defect from a dead or blocking upstream site.

## Concrete defects to fix first

1. `nuviotr/m3u.mooncrown.addon`: manifest points to missing `eklentiler/M3U/ListM3u.js`. A similarly named file exists at `providers/M3U/ListM3u.js`, but it does not implement the array-returning Nuvio `getStreams` contract in local tests.
2. `nuvio-providers/moviebox`: manifest points to missing `providers/moviebox.js`.
3. `nuvio-providers/myflixer-extractor`: registered as a provider, but the file exports extractor helpers rather than `getStreams`.
4. `nuviotr/providers/M3U/ListM3u.js`: unregistered and interface-incompatible for direct provider testing.

Other configuration-specific issue: All-in-One GramCinema loaded but refused to run without its own provider token in Nuvio settings.

## Reproduction

The Nuvio audit harness is `scripts/audit-nuvio-providers.cjs`; its runner is `scripts/run-provider-audit.cjs`. The WebStreamr harness is `scripts/audit-webstreamr.cjs`. The report intentionally contains no API key, access token, or full stream URLs. Results reflect network/provider state on 2026-07-19 and can change without code changes.
