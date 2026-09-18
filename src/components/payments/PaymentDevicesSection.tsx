import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit2,
  KeyRound,
  Layers,
  MonitorSmartphone,
  Plus,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { PaymentSource } from '../../types';

interface DeviceSourceAssignment {
  sourceId: string;
  sourceName?: string;
  sourceCode?: string;
  destination: string;
  destinationLabel?: string;
}

export interface PaymentDevice {
  id: string;
  deviceId: string;
  name: string;
  paymentDestination: string;
  isEnabled: boolean;
  vfCashEnabled: boolean;
  bankAlAhlyEnabled: boolean;
  online: boolean;
  internetConnected: boolean;
  appRunning: boolean;
  notificationListenerEnabled: boolean;
  busy: boolean;
  busySessionId?: string;
  lastHeartbeatAt?: string;
  lastEventAt?: string;
  appVersion?: string;
  activeRulesCount?: number;
  sources?: PaymentSource[];
  assignedSourceIds?: string[];
  assignedSources?: string[];
  sourceAssignments?: DeviceSourceAssignment[];
}

interface PaymentDevicesSectionProps {
  devices: PaymentDevice[];
  sources: PaymentSource[];
  onRefresh: () => Promise<void>;
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
}

type AssignmentDraft = Record<string, { enabled: boolean; destination: string; destinationLabel: string }>;

function assignmentsForDevice(device: PaymentDevice, sources: PaymentSource[]): AssignmentDraft {
  const draft: AssignmentDraft = {};
  const bySource = new Map((device.sourceAssignments || []).map((item) => [item.sourceId, item]));
  const legacyIds = new Set(device.assignedSourceIds || device.assignedSources || []);

  for (const source of sources) {
    const existing = bySource.get(source.id);
    draft[source.id] = {
      enabled: Boolean(existing || legacyIds.has(source.id)),
      destination: existing?.destination || '',
      destinationLabel: existing?.destinationLabel || '',
    };
  }
  return draft;
}

export const PaymentDevicesSection: React.FC<PaymentDevicesSectionProps> = ({
  devices,
  sources,
  onRefresh,
  adminRequest,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [managingDevice, setManagingDevice] = useState<PaymentDevice | null>(null);
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft>({});
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newFallbackDestination, setNewFallbackDestination] = useState('');
  const [newAssignments, setNewAssignments] = useState<AssignmentDraft>(() =>
    Object.fromEntries(sources.map((source) => [source.id, { enabled: false, destination: '', destinationLabel: '' }]))
  );
  const [provisioningSecret, setProvisioningSecret] = useState<string | null>(null);
  const [provisioningDeviceName, setProvisioningDeviceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);

  const ensureDraftShape = (draft: AssignmentDraft): AssignmentDraft => {
    const next = { ...draft };
    for (const source of sources) {
      if (!next[source.id]) next[source.id] = { enabled: false, destination: '', destinationLabel: '' };
    }
    return next;
  };

  const openAssignments = (device: PaymentDevice) => {
    setManagingDevice(device);
    setAssignmentDraft(ensureDraftShape(assignmentsForDevice(device, sources)));
    setError(null);
    setSuccess(null);
  };

  const setAssignment = (
    setter: React.Dispatch<React.SetStateAction<AssignmentDraft>>,
    sourceId: string,
    patch: Partial<AssignmentDraft[string]>
  ) => {
    setter((current) => ({
      ...ensureDraftShape(current),
      [sourceId]: {
        ...(current[sourceId] || { enabled: false, destination: '', destinationLabel: '' }),
        ...patch,
      },
    }));
  };

  const serializeAssignments = (draft: AssignmentDraft) =>
    Object.entries(draft)
      .filter(([, value]) => value.enabled)
      .map(([sourceId, value]) => ({
        sourceId,
        destination: value.destination.trim(),
        destinationLabel: value.destinationLabel.trim(),
      }));

  const saveAssignments = async () => {
    if (!managingDevice) return;
    setLoading(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/payments/devices/${managingDevice.id}/sources`, {
        method: 'PUT',
        body: JSON.stringify({ assignments: serializeAssignments(assignmentDraft) }),
      });
      setSuccess('تم حفظ مصادر الجهاز وأرقام التحويل الخاصة بكل مصدر');
      setManagingDevice(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الجهاز');
    } finally {
      setLoading(false);
    }
  };

  const createDevice = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = (await adminRequest('/api/admin/payments/devices', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: newDeviceId.trim(),
          name: newDeviceName.trim(),
          paymentDestination: newFallbackDestination.trim(),
        }),
      })) as { provisioningSecret: string; device: { id: string } };

      const assignments = serializeAssignments(newAssignments);
      if (assignments.length > 0) {
        await adminRequest(`/api/admin/payments/devices/${result.device.id}/sources`, {
          method: 'PUT',
          body: JSON.stringify({ assignments }),
        });
      }

      setProvisioningSecret(result.provisioningSecret);
      setProvisioningDeviceName(newDeviceName);
      setShowAddModal(false);
      setNewDeviceId('');
      setNewDeviceName('');
      setNewFallbackDestination('');
      setNewAssignments(
        Object.fromEntries(sources.map((source) => [source.id, { enabled: false, destination: '', destinationLabel: '' }]))
      );
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل جهاز الدفع');
    } finally {
      setLoading(false);
    }
  };

  const toggleDevice = async (device: PaymentDevice) => {
    try {
      await adminRequest(`/api/admin/payments/devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isEnabled: !device.isEnabled }),
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة الجهاز');
    }
  };

  const reprovision = async (device: PaymentDevice) => {
    if (!confirm(`توليد مفتاح جديد للجهاز "${device.name}"؟ سيحتاج المفتاح الجديد داخل تطبيق Bridge.`)) return;
    setLoading(true);
    try {
      const result = (await adminRequest(`/api/admin/payments/devices/${device.id}/reprovision`, {
        method: 'POST',
      })) as { provisioningSecret: string };
      setProvisioningSecret(result.provisioningSecret);
      setProvisioningDeviceName(device.name);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تدوير المفتاح');
    } finally {
      setLoading(false);
    }
  };

  const assignmentEditor = (
    draft: AssignmentDraft,
    setter: React.Dispatch<React.SetStateAction<AssignmentDraft>>
  ) => (
    <div className="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
      {enabledSources.map((source) => {
        const value = draft[source.id] || { enabled: false, destination: '', destinationLabel: '' };
        return (
          <div
            key={source.id}
            className={`rounded-xl border p-3 transition-colors ${
              value.enabled
                ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-950/30'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/30'
            }`}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(e) => setAssignment(setter, source.id, { enabled: e.target.checked })}
                className="w-4 h-4 rounded text-cyan-600"
              />
              <div className="min-w-0">
                <div className="font-black text-xs text-slate-900 dark:text-white">{source.displayName}</div>
                <div className="text-[10px] text-slate-400 font-mono">{source.code}</div>
              </div>
            </label>

            {value.enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    رقم / عنوان التحويل لهذا الجهاز*
                  </label>
                  <input
                    required
                    value={value.destination}
                    onChange={(e) => setAssignment(setter, source.id, { destination: e.target.value })}
                    placeholder={source.channel === 'wallet' ? '010xxxxxxxx' : 'IPA / IBAN / Account'}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    وصف اختياري
                  </label>
                  <input
                    value={value.destinationLabel}
                    onChange={(e) => setAssignment(setter, source.id, { destinationLabel: e.target.value })}
                    placeholder="فودافون كاش 1 / حساب إنستاباي"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <MonitorSmartphone className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            أجهزة الدفع المتصلة
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            لكل جهاز مصادر دفع وأرقام تحويل خاصة به. الرقم الذي يراه العميل يأتي من الجهاز الذي تم حجزه فعلياً.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold shadow-sm"
        >
          <Plus className="w-4 h-4" />
          تسجيل جهاز جديد
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {provisioningSecret && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold text-xs">
              <KeyRound className="w-4 h-4" />
              مفتاح جهاز {provisioningDeviceName} — يظهر مرة واحدة
            </div>
            <button onClick={() => setProvisioningSecret(null)} className="text-xs font-bold text-amber-700 dark:text-amber-300">
              إغلاق
            </button>
          </div>
          <div className="flex items-center gap-2 bg-white dark:bg-slate-950 border border-amber-200 dark:border-amber-900 rounded-xl p-2.5">
            <code className="flex-1 text-xs font-mono break-all select-all">{provisioningSecret}</code>
            <button
              onClick={() => navigator.clipboard.writeText(provisioningSecret)}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
            >
              نسخ
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <form
            onSubmit={createDevice}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <MonitorSmartphone className="w-5 h-5 text-cyan-600" />
                تسجيل جهاز دفع جديد
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Device ID*</label>
                <input
                  required
                  value={newDeviceId}
                  onChange={(e) => setNewDeviceId(e.target.value)}
                  placeholder="المعرف الظاهر في تطبيق Bridge"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الجهاز*</label>
                <input
                  required
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  placeholder="موبايل الدفع 1"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  وجهة احتياطية قديمة — اختياري
                </label>
                <input
                  value={newFallbackDestination}
                  onChange={(e) => setNewFallbackDestination(e.target.value)}
                  placeholder="يفضل تركها فارغة واستخدام رقم منفصل لكل مصدر بالأسفل"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-black text-slate-900 dark:text-white">
                <Layers className="w-4 h-4 text-cyan-600" />
                مصادر الدفع وأرقام هذا الجهاز
              </div>
              {assignmentEditor(newAssignments, setNewAssignments)}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold">
                إلغاء
              </button>
              <button type="submit" disabled={loading} className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                {loading ? 'جاري التسجيل...' : 'تسجيل الجهاز'}
              </button>
            </div>
          </form>
        </div>
      )}

      {managingDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">مصادر وأرقام {managingDevice.name}</h3>
                <p className="text-[10px] text-slate-500 mt-1">كل مصدر يمكن أن يملك رقماً أو عنوان تحويل مختلفاً على نفس الهاتف.</p>
              </div>
              <button onClick={() => setManagingDevice(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {assignmentEditor(assignmentDraft, setAssignmentDraft)}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => setManagingDevice(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold">
                إلغاء
              </button>
              <button onClick={() => void saveAssignments()} disabled={loading} className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold disabled:opacity-50">
                {loading ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {devices.map((device) => {
          const assignments = device.sourceAssignments || [];
          return (
            <div
              key={device.id}
              className={`border rounded-2xl p-4 bg-white dark:bg-slate-900 transition-all ${
                device.online
                  ? 'border-emerald-200 dark:border-emerald-900/40 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 opacity-80'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${device.online ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">{device.name}</h3>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-1">ID: {device.deviceId}</div>
                </div>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black ${
                    device.online
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {device.online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  {device.online ? 'متصل' : 'غير متصل'}
                </span>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">حالة الجهاز:</span>
                  <strong className={device.busy ? 'text-amber-600' : 'text-emerald-600'}>
                    {device.busy ? 'مشغول بجلسة' : 'متاح'}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">قراءة الإشعارات:</span>
                  <strong className={device.notificationListenerEnabled ? 'text-emerald-600' : 'text-amber-600'}>
                    {device.notificationListenerEnabled ? 'نشطة' : 'غير نشطة'}
                  </strong>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-slate-700 dark:text-slate-300">مصادر وأرقام التحويل</span>
                    <button onClick={() => openAssignments(device)} className="inline-flex items-center gap-1 text-[10px] font-bold text-cyan-600 dark:text-cyan-400">
                      <Edit2 className="w-3 h-3" />
                      تعديل
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {assignments.map((assignment) => (
                      <div key={assignment.sourceId} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-950 p-2">
                        <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                          {assignment.sourceName || assignment.sourceCode}
                        </span>
                        <span dir="ltr" className="text-[10px] font-mono font-bold text-slate-900 dark:text-white truncate max-w-[55%]">
                          {assignment.destination || 'لم يحدد'}
                        </span>
                      </div>
                    ))}
                    {assignments.length === 0 && (
                      <span className="text-[10px] text-amber-600">لم يتم ربط مصادر وأرقام بهذا الجهاز بعد.</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => void toggleDevice(device)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl ${
                    device.isEnabled
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {device.isEnabled ? 'تعطيل الجهاز' : 'تفعيل الجهاز'}
                </button>
                <button
                  onClick={() => void reprovision(device)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                  مفتاح جديد
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
