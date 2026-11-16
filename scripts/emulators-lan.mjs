#!/usr/bin/env node
/**
 * Start the Firebase emulators reachable from other devices on this network,
 * for testing a local build on a phone.
 *
 *   npm run emulators:lan
 *
 * `firebase.json` keeps the emulators on localhost, which is the safe default:
 * they have no authentication, so anyone who can reach them can read and write
 * the local data. This script is the explicit opt-in. It writes a throwaway
 * config with the hosts set to 0.0.0.0 and starts the emulators from it.
 * Only run it on a network you trust.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const LAN_CONFIG = 'firebase.lan.json'
const config = JSON.parse(readFileSync('firebase.json', 'utf8'))
for (const name of ['auth', 'firestore', 'storage']) {
  if (config.emulators?.[name]) config.emulators[name].host = '0.0.0.0'
}
writeFileSync(LAN_CONFIG, `${JSON.stringify(config, null, 2)}\n`)

console.log('Emulators will listen on ALL network interfaces. Use a trusted network only.')
const child = spawn('firebase', ['emulators:start', '--config', LAN_CONFIG, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
})
child.on('exit', (code) => process.exit(code ?? 0))
