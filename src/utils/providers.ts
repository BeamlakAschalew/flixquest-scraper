import {
  makeProviders,
  makeStandardFetcher,
  targets,
  type ProviderControls,
} from "@p-stream/providers";

/**
 * Build a Providers instance with standard configuration
 * @returns ProviderControls instance
 */
export function buildProviders(): ProviderControls {
  const myFetcher = makeStandardFetcher(fetch);
  return makeProviders({
    fetcher: myFetcher,
    // Will be played on any target (browser, native, extension)
    target: targets.ANY,
  });
}
