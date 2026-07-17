import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, ChevronLeft, Plus, Trash2, Loader2,
  AlertTriangle, CheckCircle, XCircle, Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { signTransaction } from '@stellar/freighter-api';
import { useAppStore } from '../store/useAppStore';
import { useEmployees } from '../hooks/useEmployees';
import { useCreatePayroll, useExecutePayroll, useExecutePayrollXDR } from '../hooks/usePayrolls';
import { payrollsApi } from '../api/payrolls';
import { fxApi, AllFXRates } from '../api/fx';
import { Employee, ExecuteResult } from '../types';

interface PayrollLine {
  employee: Employee;
  amount: string;
}

const STEPS = ['Details', 'Recipients', 'Review', 'Execute'];
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export default function CreatePayroll() {
  const navigate = useNavigate();
  const org = useAppStore((s) => s.currentOrg);
  const freighterPublicKey = useAppStore((s) => s.freighterPublicKey);
  const orgId = org?.id || '';
  const { data: employeesResponse } = useEmployees(orgId);
  const employees = employeesResponse?.data ?? [];
  const createMutation = useCreatePayroll(orgId);
  const executeMutation = useExecutePayroll();
  const executeXDRMutation = useExecutePayrollXDR();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<'XLM' | 'USDC'>('USDC');
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [payrollId, setPayrollId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [fxRates, setFxRates] = useState<AllFXRates | null>(null);
  const [freighterSigning, setFreighterSigning] = useState(false);

  useEffect(() => {
    if (step === 2) {
      fxApi.getRates().then(setFxRates).catch(() => {});
    }
  }, [step]);

  if (!org) return <p className="text-sm text-gray-500">Create an organization first.</p>;

  const total = lines.reduce((s, l) => s + parseFloat(l.amount || '0'), 0);
  const estimatedFee = lines.length * 0.00001;
  const fxRate = fxRates ? fxRates[currency].USD : null;
  const totalUSD = fxRate ? total * fxRate : null;

  const addLine = () => {
    const emp = employees.find((e) => e.id === selectedEmpId);
    if (!emp || !lineAmount || parseFloat(lineAmount) <= 0) return;
    if (lines.find((l) => l.employee.id === emp.id)) {
      toast.error('Employee already added');
      return;
    }
    setLines([...lines, { employee: emp, amount: lineAmount }]);
    setSelectedEmpId('');
    setLineAmount('');
  };

  const removeLine = (id: string) => setLines(lines.filter((l) => l.employee.id !== id));

  const handleCreate = async () => {
    if (!name || lines.length === 0) return;
    try {
      const payroll = await createMutation.mutateAsync({
        name,
        currency,
        items: lines.map((l) => ({ employeeId: l.employee.id, amount: l.amount })),
      });
      setPayrollId(payroll.id);
      setStep(3);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleExecute = async () => {
    if (!secretKey || !payrollId) return;
    try {
      const res = await executeMutation.mutateAsync({ id: payrollId, sourceSecretKey: secretKey });
      setResult(res);
      setSecretKey('');
      if (res.failCount === 0) toast.success('Payroll executed successfully!');
      else toast.error(`${res.failCount} payment(s) failed`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleFreighterExecute = async () => {
    if (!freighterPublicKey || !payrollId) return;
    setFreighterSigning(true);
    try {
      const { xdr } = await payrollsApi.getXDR(payrollId, freighterPublicKey);
      const signed = await signTransaction(xdr, { networkPassphrase: TESTNET_PASSPHRASE });
      if (signed.error) throw new Error(signed.error.message || 'Freighter signing failed');

      const res = await executeXDRMutation.mutateAsync({ id: payrollId, signedXDR: signed.signedTxXdr });
      setResult(res);
      if (res.failCount === 0) toast.success('Payroll executed successfully!');
      else toast.error(`${res.failCount} payment(s) failed`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFreighterSigning(false);
    }
  };

  const isExecuting = executeMutation.isPending || executeXDRMutation.isPending || freighterSigning;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Run Payroll</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
              i === step ? 'bg-indigo-600 text-white' : i < step ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'
            }`}>
              <span>{i + 1}</span>
              <span>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className="w-6 h-px bg-gray-200 mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 0: Details */}
      {step === 0 && (
        <div className="card p-6 space-y-4">
          <div>
            <label className="label">Payroll Name *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="May 2026 Payroll" />
          </div>
          <div>
            <label className="label">Currency</label>
            <div className="flex gap-3">
              {(['USDC', 'XLM'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    currency === c ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {c}
                  {c === 'USDC' && <span className="ml-1 text-xs text-gray-400">(Stablecoin)</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setStep(1)} disabled={!name} className="btn-primary">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Recipients */}
      {step === 1 && (
        <div className="card p-6 space-y-4">
          <div className="flex gap-2">
            <select className="input flex-1" value={selectedEmpId} onChange={(e) => setSelectedEmpId(e.target.value)}>
              <option value="">Select employee…</option>
              {employees.filter((e) => !lines.find((l) => l.employee.id === e.id)).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            <input
              className="input w-32"
              type="number"
              min="0"
              step="0.01"
              placeholder={`Amount (${currency})`}
              value={lineAmount}
              onChange={(e) => setLineAmount(e.target.value)}
            />
            <button onClick={addLine} className="btn-primary shrink-0">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {lines.length > 0 && (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="table-th">Employee</th>
                  <th className="table-th">Wallet</th>
                  <th className="table-th text-right">Amount</th>
                  <th className="table-th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((l) => (
                  <tr key={l.employee.id}>
                    <td className="table-td font-medium">{l.employee.name}</td>
                    <td className="table-td font-mono text-xs text-gray-400">
                      {l.employee.wallet_address.slice(0, 6)}…{l.employee.wallet_address.slice(-4)}
                    </td>
                    <td className="table-td text-right font-mono">{l.amount} {currency}</td>
                    <td className="table-td">
                      <button onClick={() => removeLine(l.employee.id)} className="text-red-400 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(0)} className="btn-secondary"><ChevronLeft className="w-4 h-4" /> Back</button>
            <button onClick={() => setStep(2)} disabled={lines.length === 0} className="btn-primary">
              Review <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Payment Summary</h2>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Payroll name</span>
              <span className="font-medium">{name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Currency</span>
              <span className="font-mono font-medium">{currency}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Recipients</span>
              <span className="font-medium">{lines.length}</span>
            </div>
            <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-semibold">
              <span>Total</span>
              <div className="text-right">
                <span className="font-mono">{total.toFixed(7)} {currency}</span>
                {totalUSD !== null && (
                  <span className="block text-xs font-normal text-gray-400">
                    ≈ ${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                    {fxRates?.stale && <span className="ml-1 text-amber-500">(stale rate)</span>}
                  </span>
                )}
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>Estimated network fee</span>
              <span className="font-mono">~{estimatedFee.toFixed(5)} XLM</span>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-th">Employee</th>
                <th className="table-th text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lines.map((l) => (
                <tr key={l.employee.id}>
                  <td className="table-td">{l.employee.name}</td>
                  <td className="table-td text-right font-mono">{l.amount} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="btn-secondary"><ChevronLeft className="w-4 h-4" /> Back</button>
            <button onClick={handleCreate} disabled={createMutation.isPending} className="btn-primary">
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirm & Continue <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Execute */}
      {step === 3 && !result && (
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Execute Payroll</h2>

          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Sending to</span>
              <span className="font-medium">{lines.length} recipients</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-500">Total</span>
              <span className="font-mono font-semibold">{total.toFixed(7)} {currency}</span>
            </div>
          </div>

          {freighterPublicKey ? (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex gap-2 text-xs text-emerald-800">
                <Wallet className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Freighter connected</p>
                  <p className="font-mono text-emerald-700 mt-0.5">
                    {freighterPublicKey.slice(0, 8)}…{freighterPublicKey.slice(-6)}
                  </p>
                </div>
              </div>
              <button
                onClick={handleFreighterExecute}
                disabled={isExecuting}
                className="btn-primary w-full justify-center py-3"
              >
                {isExecuting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                ) : (
                  <><Wallet className="w-4 h-4" /> Sign & Execute with Freighter</>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Your secret key is used only for signing this transaction. It is never stored or transmitted to our servers.</span>
              </div>

              <div>
                <label className="label">Source Wallet Secret Key *</label>
                <input
                  className="input font-mono text-xs"
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder="S..."
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-gray-400">
                  The Stellar secret key of the wallet funding this payroll. Or{' '}
                  <a href="/settings" className="text-indigo-600 hover:underline">connect Freighter</a> to sign without entering your key.
                </p>
              </div>

              <button
                onClick={handleExecute}
                disabled={!secretKey || isExecuting}
                className="btn-primary w-full justify-center py-3"
              >
                {isExecuting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing payments…</>
                ) : (
                  'Execute Payroll'
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            {result.failCount === 0 ? (
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            ) : (
              <XCircle className="w-8 h-8 text-red-500" />
            )}
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {result.failCount === 0 ? 'Payroll Completed' : 'Payroll Completed with Errors'}
              </h2>
              <p className="text-xs text-gray-500">
                {result.successCount} succeeded · {result.failCount} failed
              </p>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-th">Item</th>
                <th className="table-th">Status</th>
                <th className="table-th">TX Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {result.results.map((r) => (
                <tr key={r.payrollItemId}>
                  <td className="table-td text-gray-500 font-mono text-xs">{r.payrollItemId.slice(0, 8)}…</td>
                  <td className="table-td">
                    {r.success ? (
                      <span className="text-emerald-600 text-xs font-medium">✓ Success</span>
                    ) : (
                      <span className="text-red-500 text-xs">{r.error}</span>
                    )}
                  </td>
                  <td className="table-td font-mono text-xs">
                    {r.txHash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${r.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        {r.txHash.slice(0, 10)}…
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex gap-2">
            <button onClick={() => navigate(`/payrolls/${payrollId}`)} className="btn-primary">
              View Payroll Details
            </button>
            <button onClick={() => navigate('/')} className="btn-secondary">
              Back to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
