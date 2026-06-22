/**
 * Network configuration — 12-factor (env-driven) so a build targets testnet OR
 * mainnet WITHOUT any code change. Testnet defaults keep dev/CI zero-config; a
 * mainnet build sets the VITE_BENZO_* vars (RPC, passphrase, deployment JSON,
 * operator addresses). This removes the "hardcoded testnet" smell — going to
 * production is an env swap + funded operators + a registered mainnet deployment.
 *
 * Everything here is PUBLIC: RPC URLs, contract IDs, and a funded G-address used
 * only as a read/simulation footprint source. No secret material is ever client-side.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

export const NETWORK = env.VITE_BENZO_NETWORK ?? "testnet";
export const RPC_URL = env.VITE_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = env.VITE_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

/** Human label for the active network — never hardcode "testnet" on a money screen. */
export const NETWORK_LABEL = NETWORK === "public" || NETWORK === "pubnet" ? "Stellar" : "Stellar Testnet";

/** Testnet deployment (deployments/testnet.json) — the zero-config default. */
const TESTNET_DEPLOYMENT = {
  pool: "CAQZCOJUYFEHDJLGLAMMUTHGWGYGZZACMI3EY32X2T2AVDTD3FMGWPRU",
  verifier: "CCWBNQCJ3M34OJAY6OTHWNOLV7Y43KGDU5K3LFTQ7Z3G6AP4RFEDVS7A",
  merkle: "CCSZAPFMOYRFF7KPS4VOKUCW6MW5G7VPLJH23PBTONK6AX4MLWYHJULH",
  nullifierSet: "CBUHBSP2XBTG2LUYQOD47RUP5LJWNJBOXDAOLRKQ7FKIRVYJLRMSKOYY",
  aspMembership: "CCBEFUSOTA2HOB5L5EPKMKWH5OETJPR2WLPXCDEK7HLOYFCWDIP4J7MI",
  aspNonMembership: "CAOH5EM6T6JPK2BJEH4WJU7COEXQ34DWY6CBCFCO6US4TEAN3TXFBVIE",
  viewkeyAnchor: "CBWAO55F26QNAEUNWS6O2B543SR2DUKA2XBSWZJ5EXRQUWY67VS4O3FA",
  mvkRegistry: "CDGXWVSKENNAPTLNM35IS2YTSEW7PHAXBCQ52OKQD5Z4EUYY7ARW4CDQ",
  handleRegistry: "CAOKUPYVHN4ONY2STJK2QQO2Z3X2F3YQQWKYZV6J6NIGGPGU577BBLJI",
  token: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  treeLevels: 32,
  aspLevels: 16,
  smtLevels: 16,
};

/** Deployment coordinates. A mainnet build sets VITE_BENZO_DEPLOYMENT (the JSON
 *  of deployments/mainnet.json); otherwise the testnet defaults apply. */
export const DEPLOYMENT: typeof TESTNET_DEPLOYMENT = env.VITE_BENZO_DEPLOYMENT
  ? { ...TESTNET_DEPLOYMENT, ...(JSON.parse(env.VITE_BENZO_DEPLOYMENT) as Partial<typeof TESTNET_DEPLOYMENT>) }
  : TESTNET_DEPLOYMENT;

export const VERIFIER_ID = DEPLOYMENT.verifier;

/** Funded G-address used only as a read/simulation footprint source (never signs). */
export const SIM_SOURCE = env.VITE_BENZO_SIM_SOURCE ?? "GBRMUZELYDNXSBYF5KOLLSV4XLQYNZJQNLXQ3HTFCWNRIBS3I6EUBCMP";

/** The gas relay's operator G-address (its own funded key, separate from any other). */
export const RELAYER_ADDRESS = env.VITE_BENZO_RELAYER_ADDRESS ?? "GD2U26BTLNEKRLM7AMXPO5T64I7SPRPUF26T44RHSJBLFI5YGRKLZMT7";
