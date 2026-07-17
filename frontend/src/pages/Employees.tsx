import { useState, useRef, useCallback } from 'react';
import { Plus, Upload, Trash2, Loader2, Download, X, AlertCircle, CheckCircle, Copy } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { useAppStore } from '../store/useAppStore';
import { useEmployees, useCreateEmployee, useDeleteEmployee, useImportEmployees } from '../hooks/useEmployees';
import { Employee } from '../types';

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const VALID_CURRENCIES = new Set(['XLM', 'USDC']);
const VALID_ROLES = new Set(['employee', 'finance', 'admin']);

interface ParsedRow {
  name: string;
  email: string;
  wallet_address: string;
  role: string;
  currency: string;
  errors: string[];
}

function validateRow(raw: Record<string, string>): ParsedRow {
  const row: ParsedRow = {
    name: (raw.name || '').trim(),
    email: (raw.email || '').trim(),
    wallet_address: (raw.wallet_address || '').trim(),
    role: (raw.role || 'employee').trim().toLowerCase(),
    currency: (raw.currency || 'USDC').trim().toUpperCase(),
    errors: [],
  };

  if (!row.name) row.errors.push('Name is required');
  if (!row.wallet_address) {
    row.errors.push('Wallet address is required');
  } else if (row.wallet_address.length !== 56 || !row.wallet_address.startsWith('G')) {
    row.errors.push('Invalid Stellar wallet address (must be 56 chars, starting with G)');
  }
  if (!VALID_CURRENCIES.has(row.currency)) {
    row.errors.push(`Unrecognized currency "${row.currency}" — use XLM or USDC`);
  }
  if (!VALID_ROLES.has(row.role)) {
    row.errors.push(`Unrecognized role "${row.role}" — use employee, finance, or admin`);
  }

  return row;
}

function downloadSampleCSV() {
  const content = [
    'name,email,wallet_address,role,currency',
    'Alice Okafor,alice@example.com,GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5,employee,USDC',
    'Bob Smith,bob@example.com,GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGWKX2CXNV5YZMLXNZJHBX,employee,XLM',
  ].join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'employees-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

type ModalState = 'closed' | 'preview' | 'results';

interface ImportResults {
  imported: number;
  errors: string[];
}

export default function Employees() {
  const org = useAppStore((s) => s.currentOrg);
  const orgId = org?.id || '';
  const { data: employeesResponse, isLoading } = useEmployees(orgId);
  const employees = employeesResponse?.data ?? [];
  const createMutation = useCreateEmployee(orgId);
  const deleteMutation = useDeleteEmployee(orgId);
  const importMutation = useImportEmployees(orgId);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', wallet_address: '', role: 'employee', currency: 'USDC' });

  const [modalState, setModalState] = useState<ModalState>('closed');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importResults, setImportResults] = useState<ImportResults | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync(form as Partial<Employee>);
      toast.success('Employee added');
      setForm({ name: '', email: '', wallet_address: '', role: 'employee', currency: 'USDC' });
      setShowForm(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}?`)) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Employee removed');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const parseFile = useCallback((file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        const rows = result.data.map(validateRow);
        setParsedRows(rows);
        setModalState('preview');
      },
    });
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
    e.target.value = '';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.csv')) parseFile(file);
    else toast.error('Please drop a CSV file');
  }, [parseFile]);

  const handleImportConfirm = async () => {
    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      toast.error('No valid rows to import');
      return;
    }
    try {
      const result = await importMutation.mutateAsync(validRows as Partial<Employee>[]);
      const skipped = parsedRows.filter((r) => r.errors.length > 0);
      setImportResults({
        imported: result.imported,
        errors: skipped.map((r, i) => `Row ${i + 1} (${r.name || 'unnamed'}): ${r.errors.join('; ')}`),
      });
      setModalState('results');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const closeModal = () => {
    setModalState('closed');
    setParsedRows([]);
    setImportResults(null);
  };

  const validCount = parsedRows.filter((r) => r.errors.length === 0).length;
  const invalidCount = parsedRows.length - validCount;

  if (!org) return <p className="text-sm text-gray-500">Create an organization first.</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Employees</h1>
        <div className="flex gap-2">
          <button onClick={downloadSampleCSV} className="btn-secondary text-xs">
            <Download className="w-4 h-4" /> Template
          </button>
          <button onClick={() => { setModalState('preview'); fileRef.current?.click(); }} className="btn-secondary">
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Employee
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">New Employee</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name *</label>
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Alice Okafor" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="alice@example.com" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Stellar Wallet Address *</label>
              <input className="input font-mono text-xs" required value={form.wallet_address} onChange={(e) => setForm({ ...form, wallet_address: e.target.value })} placeholder="G..." />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="employee">Employee</option>
                <option value="finance">Finance</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="label">Preferred Currency</label>
              <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option value="USDC">USDC</option>
                <option value="XLM">XLM</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Add Employee
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <div className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" /></div>
        ) : employees.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">
            No employees yet. Add your first team member above.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-th">Name</th>
                <th className="table-th">Email</th>
                <th className="table-th">Wallet</th>
                <th className="table-th">Currency</th>
                <th className="table-th">Role</th>
                <th className="table-th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="table-td font-medium text-gray-900">{emp.name}</td>
                  <td className="table-td text-gray-500">{emp.email || '—'}</td>
                  <td className="table-td font-mono text-xs text-gray-500">
                    <span className="flex items-center gap-1.5">
                      {truncateAddress(emp.wallet_address)}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(emp.wallet_address);
                          toast.success('Copied!');
                        }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        title="Copy wallet address"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </span>
                  </td>
                  <td className="table-td">
                    <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">{emp.currency}</span>
                  </td>
                  <td className="table-td capitalize text-gray-500">{emp.role}</td>
                  <td className="table-td">
                    <button onClick={() => handleDelete(emp.id, emp.name)} className="text-red-400 hover:text-red-600 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CSV Import Modal */}
      {modalState !== 'closed' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">
                {modalState === 'preview' ? 'Import Employees — Preview' : 'Import Results'}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-4">
              {/* Drag-and-drop zone (shown when no file parsed yet) */}
              {modalState === 'preview' && parsedRows.length === 0 && (
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
                    isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Upload className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-700">Drop a CSV file here or click to browse</p>
                  <p className="text-xs text-gray-400 mt-1">Columns: name, email, wallet_address, role, currency</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadSampleCSV(); }}
                    className="mt-3 text-xs text-indigo-600 hover:underline"
                  >
                    Download sample template
                  </button>
                </div>
              )}

              {/* Preview table */}
              {modalState === 'preview' && parsedRows.length > 0 && (
                <>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-emerald-700">
                      <CheckCircle className="w-3.5 h-3.5" /> {validCount} valid
                    </span>
                    {invalidCount > 0 && (
                      <span className="flex items-center gap-1 text-red-600">
                        <AlertCircle className="w-3.5 h-3.5" /> {invalidCount} with errors (will be skipped)
                      </span>
                    )}
                  </div>

                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="table-th">#</th>
                          <th className="table-th">Name</th>
                          <th className="table-th">Email</th>
                          <th className="table-th">Wallet</th>
                          <th className="table-th">Role</th>
                          <th className="table-th">Currency</th>
                          <th className="table-th">Validation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {parsedRows.map((row, i) => (
                          <tr key={i} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
                            <td className="table-td text-gray-400">{i + 1}</td>
                            <td className="table-td font-medium">{row.name || <span className="text-red-400 italic">missing</span>}</td>
                            <td className="table-td text-gray-500">{row.email || '—'}</td>
                            <td className="table-td font-mono text-gray-500">
                              {row.wallet_address ? `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}` : <span className="text-red-400 italic">missing</span>}
                            </td>
                            <td className="table-td capitalize text-gray-500">{row.role}</td>
                            <td className="table-td font-mono">{row.currency}</td>
                            <td className="table-td">
                              {row.errors.length === 0 ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <span className="text-red-500">{row.errors.join('; ')}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Results */}
              {modalState === 'results' && importResults && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-emerald-600" />
                    <p className="text-sm font-medium text-emerald-800">
                      Successfully imported {importResults.imported} employee{importResults.imported !== 1 ? 's' : ''}
                    </p>
                  </div>

                  {importResults.errors.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-gray-700">{importResults.errors.length} row(s) skipped:</p>
                      {importResults.errors.map((err, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded p-2">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{err}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
              {modalState === 'preview' && parsedRows.length > 0 && (
                <>
                  <button onClick={() => { setParsedRows([]); fileRef.current?.click(); }} className="btn-secondary text-xs">
                    Choose different file
                  </button>
                  <button
                    onClick={handleImportConfirm}
                    disabled={importMutation.isPending || validCount === 0}
                    className="btn-primary"
                  >
                    {importMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    Import {validCount} employee{validCount !== 1 ? 's' : ''}
                  </button>
                </>
              )}
              {(modalState === 'results' || (modalState === 'preview' && parsedRows.length === 0)) && (
                <div className="ml-auto">
                  <button onClick={closeModal} className="btn-primary">Done</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
