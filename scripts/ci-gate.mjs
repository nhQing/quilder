/**
 * Phán quyết CI cho MỘT commit, từ danh sách run mà
 * `gh run list --workflow ci.yml --commit <sha> --json databaseId,status,conclusion,event,createdAt,url`
 * trả về. Thuần, không gọi `gh`, để test được. `scripts/release.mjs` là nơi dùng.
 *
 * Luật:
 *  - Run `cancelled`/`skipped` không nói gì về code (concurrency `cancel-in-progress`
 *    của ci.yml huỷ run cũ khi có push mới), nên không được tính.
 *  - Run đã xong MỚI NHẤT quyết định. Chạy lại đỏ sau một lần xanh vẫn là đỏ: hoặc có
 *    flake cần nhìn, hoặc môi trường đã đổi. Không chọn kết quả mình thích.
 *  - Xanh thì cho qua, kể cả khi có run mới hơn đang chạy (vd. lượt chạy đêm).
 *    Chưa xanh mà còn run đang chạy thì chờ, vì có thể đó là lượt chạy lại.
 *
 * "Xanh" là `conclusion` của cả workflow, tức job `check` + `visual`. Job `e2e` đang
 * `continue-on-error` nên đỏ cũng không chặn, cùng luật với merge.
 */

const IGNORED = new Set(['cancelled', 'skipped']);

/**
 * @param {Array<{databaseId:number,status:string,conclusion:string,event:string,createdAt:string,url:string}>} runs
 * @returns {{kind:'ok',run:object}|{kind:'pending',run:object}|{kind:'failed',run:object}|{kind:'missing'}}
 */
export function ciVerdict(runs) {
  const newest = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const last = newest.find((r) => r.status === 'completed' && !IGNORED.has(r.conclusion));
  const pending = newest.find((r) => r.status !== 'completed');

  if (last?.conclusion === 'success') return { kind: 'ok', run: last };
  if (pending) return { kind: 'pending', run: pending };
  if (last) return { kind: 'failed', run: last };
  return { kind: 'missing' };
}
