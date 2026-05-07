import { LyraBundle } from '../../src/bundle';
import { generateTicketArray } from '../tickets.fixture';
import { testConfig } from '../test-config';

const tickets = generateTicketArray(100_000);
const bundle = await LyraBundle.create(tickets, testConfig);
const json = bundle.toJSON();
const wire = JSON.stringify(json);
const bin = bundle.serialize('binary');

const fmt = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB (${n.toLocaleString()} bytes)`;
// eslint-disable-next-line no-console
console.log('v3.1 JSON wire size :', fmt(wire.length));
// eslint-disable-next-line no-console
console.log('v4 binary size      :', fmt(bin.byteLength));
// eslint-disable-next-line no-console
console.log('binary / json ratio :', `${((bin.byteLength / wire.length) * 100).toFixed(1)}%`);
