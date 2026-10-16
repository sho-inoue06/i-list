// F-23：単体HTML版だけの決定表入力。前例は導出するだけで保存しない。
import { TODAY, dateDayNumber, findCert, evalCellInputs, decisionIndex, findDecision } from "../src/IListApp.jsx";

const numberOf = (cert, run, reg) => (findCert(cert, run.key, reg.rid)?.ck || "").trim();

export function makeCertStatusContext(runs, cert, decisions, sameCtx, today = TODAY) {
  const decIdx = decisionIndex(decisions);
  return {
    evaluate(run, reg) {
      const ck = numberOf(cert, run, reg) || null;
      const lo = dateDayNumber(run.lo);
      const base = sameCtx.base(run);
      // 同型式は厳密に前のLO、比較元は同じLOも含む。空の型式・LOは根拠にしない。
      const precedent = lo !== null && (
        (!!run.typeId?.trim() && runs.some((prev) => prev.key !== run.key && prev.typeId === run.typeId &&
          dateDayNumber(prev.lo) !== null && dateDayNumber(prev.lo) < lo && !!numberOf(cert, prev, reg))) ||
        (base.state === "ok" && dateDayNumber(base.baseRun.lo) !== null &&
          dateDayNumber(base.baseRun.lo) <= lo && !!numberOf(cert, base.baseRun, reg))
      );
      const planVisible = !ck && !precedent && lo !== null && findDecision(decIdx, run.key, reg.rid)?.state !== "対象外";
      const planned = planVisible && !!findCert(cert, run.key, reg.rid)?.planned;
      const canPlan = planVisible && lo > dateDayNumber(today);
      const certPlan = ck || precedent ? "実績あり" : planned ? "実績なし+予定あり" : "実績なし+予定なし";
      const handover = !ck && precedent;
      return { ...evalCellInputs(run, reg, sameCtx.effective(run, reg), today, { ck, certPlan, handover }),
        certPlan, handover, planVisible, planned, canPlan };
    },
  };
}

// 明示的なチェック操作だけが予定の保存値を変える。条件変化で隠れても値は保持する。
export function setCertPlanned(cert, runKey, rid, planned) {
  const i = cert.findIndex((c) => c.runKey === runKey && c.rid === rid);
  if (i < 0) return planned ? [...cert, { runKey, rid, ck: "", planned: true }] : cert;
  const cur = cert[i];
  if (cur.planned === planned) return cert;
  if (!planned && cur.ck === "") return cert.filter((_, j) => j !== i);
  return cert.map((c, j) => j === i ? { ...c, planned } : c);
}
