import { startQaServer } from './scripts/qa-server.mjs';
const server = await startQaServer({ port: 0 });
for (const [grams, dest, variant] of [[500,'tel-aviv','classico'],[1000,'tel-aviv','classico'],[2000,'tel-aviv','classico'],[500,'tel-aviv','unspecified'],[500,'eilat','classico']]) {
  const url = `${server.url}/api/board?grams=${grams}&dest=${dest}&variant=${variant}`;
  const board = await fetch(url).then(r => r.json());
  console.log(`\n===== ${grams}g ${dest} ${variant} =====`);
  console.log('best:', board.best && { vendor: board.best.vendor.name, totalIls: board.best.totalIls, key: board.best.key, ship: board.best.shipping, units: board.best.units, packCount: board.best.packCount, packGrams: board.best.packGrams });
  console.log('ranked:', board.ranked.map(q => ({ vendor: q.vendor.name, key: q.key, total: q.totalIls, perKg: q.ilsPerKg, units: q.units, pack: `${q.packCount ?? 1}x${q.packGrams ?? '?'}`, ship: q.shipping?.amountIls, cert: q.shipping?.certainty, mode: q.shipping?.mode })));
  console.log('unrankable:', board.unrankable.map(q => ({ vendor: q.vendor.name, reasons: q.reasons, shipping: q.shipping })));
  console.log('staleOrUnavailable:', board.staleOrUnavailable.map(q => ({ vendor: q.vendor.name, labels: q.labels })));
  console.log('pickup:', board.pickup.map(q => ({ vendor: q.vendor.name, total: q.totalIls })));
  console.log('counts:', board.counts, 'freshness:', board.freshness);
  console.log('bestPerKg:', board.bestPerKg && { vendor: board.bestPerKg.vendor.name, key: board.bestPerKg.key, perKg: board.bestPerKg.ilsPerKg });
}
await server.close();
