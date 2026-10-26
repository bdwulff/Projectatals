import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Mac runtime bootstrap pins official architecture archives and verifies manifest plus archive before extraction',async()=>{
 const script=await readFile(new URL('../src/bootstrap-node.sh',import.meta.url),'utf8');const launcher=await readFile(new URL('../Start Jarvis.command',import.meta.url),'utf8');
 assert.match(script,/arm64\) printf 'arm64'/);assert.match(script,/x86_64\) printf 'x64'/);assert.match(script,/Unsupported Mac architecture/);
 assert.match(script,/v24\.22\.1/);assert.match(script,/89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7/);assert.match(script,/d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035/);
 assert.match(script,/SHASUMS256\.txt/);assert.match(script,/jarvis_manifest.*!=.*jarvis_expected/);assert.match(script,/jarvis_actual.*!=.*jarvis_expected/);
 assert.ok(script.indexOf('Node checksum verification failed')<script.indexOf('tar -xzf'));
 assert.ok(script.indexOf('jarvis_node_archive_paths_safe "$jarvis_folder"')<script.indexOf('tar -xzf'));
 assert.match(script,/https:\/\/nodejs\.org\/dist/);assert.match(script,/--proto '=https'/);assert.match(script,/\[y\/N\]/);assert.match(script,/Application Support\/Jarvis\/runtime/);
 assert.ok(!/curl[^\n]*\|\s*(?:sh|bash|zsh)/.test(script));assert.ok(!/sudo|export PATH/.test(script));assert.match(launcher,/JARVIS_NODE=\$\(jarvis_install_node\)/);
});
