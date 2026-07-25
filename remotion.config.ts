import { Config } from '@remotion/cli/config'

// Wird ausschließlich von der Remotion-CLI gelesen — Next.js kennt diese
// Datei nicht. Die Artefakte landen in `public/` und sind das Einzige, was
// die App zur Laufzeit von Remotion sieht.
Config.setEntryPoint('remotion/index.ts')
Config.setVideoImageFormat('jpeg')
Config.setOverwriteOutput(true)
