import React, { useState } from 'react';
import {
  MonitorSmartphone,
  Plus,
  Wifi,
  WifiOff,
  RefreshCw,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Edit2,
  X,
  Check,
} from 'lucide-react';
import { PaymentSource } from '../../types';

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
  assignedSources?: string[]; // source IDs
}

interface PaymentDevicesSectionProps {
  devices: PaymentDevice[];
  sources: PaymentSource[];
  onRefresh: () => Promise<void>;
  adminRequest: <T>(path: string, options?: RequestInit) => Promise<T>;
}

export const PaymentDevicesSection: React.FC<PaymentDevicesSectionProps> = ({
  devices,
  sources,
  onRefresh,
  adminRequest,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [managingSourcesDeviceId, setManagingSourcesDeviceId] = useState<string | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [provisioningSecret, setProvisioningSecret] = useState<string | null>(null);
  const [provisioningDeviceName, setProvisioningDeviceName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states for new device
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDestination, setNewDestination] = useState('');
  const [newSelectedSources, setNewSelectedSources] = useState<string[]>([]);

  const handleOpenSourceAssignment = (device: PaymentDevice) => {
    setManagingSourcesDeviceId(device.id);
    setSelectedSourceIds(device.assignedSources || []);
    setError(null);
  };

  const handleSaveSourceAssignment = async () => {
    if (!managingSourcesDeviceId) return;
    setLoading(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/payments/devices/${managingSourcesDeviceId}/sources`, {
        method: 'PUT',
        body: JSON.stringify({ sourceIds: selectedSourceIds }),
      });
      setSuccess('تم تحديث ربط مصادر الدفع بالجهاز بنجاح');
      setManagingSourcesDeviceId(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ مصادر الجهاز');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = (await adminRequest('/api/admin/payments/devices', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: newDeviceId.trim(),
          name: newDeviceName.trim(),
          paymentDestination: newDestination.trim(),
          sourceIds: newSelectedSources,
        }),
      })) as { provisioningSecret: string; device: any };

      // If sources were selected, also ensure they are assigned
      if (newSelectedSources.length > 0 && result.device?.id) {
        try {
          await adminRequest(`/api/admin/payments/devices/${result.device.id}/sources`, {
            method: 'PUT',
            body: JSON.stringify({ sourceIds: newSelectedSources }),
          });
        } catch {
          // ignore if already done
        }
      }

      setProvisioningSecret(result.provisioningSecret);
      setProvisioningDeviceName(newDeviceName);
      setShowAddModal(false);
      setNewDeviceId('');
      setNewDeviceName('');
      setNewDestination('');
      setNewSelectedSources([]);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل جهاز الدفع');
    } finally {
      setLoading(false);
    }
  };

  const handleReprovision = async (device: PaymentDevice) => {
    if (!confirm(`هل أنت متأكد من تدوير وتوليد مفتاح HMAC جديد للجهاز "${device.name}"؟ سيتوقف الاستقبال حتى يتم إدخال المفتاح الجديد على الهاتف.`)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = (await adminRequest(`/api/admin/payments/devices/${device.id}/reprovision`, {
        method: 'POST',
      })) as { provisioningSecret: string };
      setProvisioningSecret(result.provisioningSecret);
      setProvisioningDeviceName(device.name);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تدوير مفتاح الجهاز');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDevice = async (device: PaymentDevice) => {
    try {
      await adminRequest(`/api/admin/payments/devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isEnabled: !device.isEnabled }),
      });
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تعديل حالة الجهاز');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
            <MonitorSmartphone className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
            أجهزة الدفع المتصلة (Bridge Devices)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            إدارة هواتف أندرويد المزودة بتطبيق جسر الإشعارات المشفر، وحالات الاتصال، وربط كل هاتف بمصادر دفع محددة.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          تسجيل جهاز هاتف جديد
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Secret Reveal Modal */}
      {provisioningSecret && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold text-xs">
              <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>مفتاح التشفير لجهاز: {provisioningDeviceName} (يظهر لمرة واحدة فقط)</span>
            </div>
            <button
              onClick={() => setProvisioningSecret(null)}
              className="text-xs text-amber-700 dark:text-amber-300 font-bold hover:underline"
            >
              تم الحفظ والإغلاق
            </button>
          </div>
          <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
            انسخ هذا المفتاح وضعه فوراً في شاشة الإعدادات داخل تطبيق Payment Bridge على الهاتف لتوثيق توقيعات HMAC:
          </p>
          <div className="flex items-center gap-2 bg-white dark:bg-slate-950 border border-amber-200 dark:border-amber-900 rounded-xl p-2.5">
            <code className="text-xs font-mono font-bold text-slate-900 dark:text-amber-200 break-all select-all flex-1">
              {provisioningSecret}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(provisioningSecret);
                alert('تم نسخ المفتاح إلى الحافظة');
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 transition-colors"
            >
              نسخ
            </button>
          </div>
        </div>
      )}

      {/* Add Device Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <MonitorSmartphone className="w-5 h-5 text-cyan-600" />
                تسجيل جهاز دفع جديد
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDevice} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  معرّف الجهاز (Device ID)*
                </label>
                <input
                  type="text"
                  required
                  value={newDeviceId}
                  onChange={(e) => setNewDeviceId(e.target.value)}
                  placeholder="phone-vf-01 أو المعرف الظاهر في تطبيق الجسر"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-xs focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">اسم الجهاز*</label>
                <input
                  type="text"
                  required
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  placeholder="هاتف الفرع - فودافون كاش 1"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  رقم الوجهة الافتراضي (Destination Number)
                </label>
                <input
                  type="text"
                  value={newDestination}
                  onChange={(e) => setNewDestination(e.target.value)}
                  placeholder="01012345678"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono text-xs focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2">
                  مصادر الدفع التي يستقبلها هذا الهاتف:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border border-slate-100 dark:border-slate-800 rounded-xl">
                  {sources.map((src) => {
                    const isChecked = newSelectedSources.includes(src.id);
                    return (
                      <label
                        key={src.id}
                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                          isChecked
                            ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-950/40 text-cyan-900 dark:text-cyan-200'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewSelectedSources([...newSelectedSources, src.id]);
                            } else {
                              setNewSelectedSources(newSelectedSources.filter((id) => id !== src.id));
                            }
                          }}
                          className="w-4 h-4 rounded text-cyan-600 focus:ring-cyan-500"
                        />
                        <span className="font-semibold text-xs">{src.displayName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {loading ? 'جاري التسجيل...' : 'تسجيل واستخراج المفتاح'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Source Assignment Modal */}
      {managingSourcesDeviceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-600" />
                تخصيص مصادر الدفع للهاتف
              </h3>
              <button onClick={() => setManagingSourcesDeviceId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              اختر مصادر الدفع التي يستقبل هذا الجهاز إشعاراتها ويتم توجيه جلسات الدفع إليه وفقها:
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {sources.map((src) => {
                const isChecked = selectedSourceIds.includes(src.id);
                return (
                  <label
                    key={src.id}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      isChecked
                        ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-950/40 text-cyan-900 dark:text-cyan-200'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSourceIds([...selectedSourceIds, src.id]);
                          } else {
                            setSelectedSourceIds(selectedSourceIds.filter((id) => id !== src.id));
                          }
                        }}
                        className="w-4 h-4 rounded text-cyan-600 focus:ring-cyan-500"
                      />
                      <div>
                        <div className="font-bold text-xs">{src.displayName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{src.code}</div>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                      {src.channel}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setManagingSourcesDeviceId(null)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveSourceAssignment}
                disabled={loading}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-xs font-bold transition-colors disabled:opacity-50"
              >
                {loading ? 'جاري الحفظ...' : 'حفظ التخصيص'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Devices Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {devices.map((device) => {
          const isOnline = device.online;
          const assignedSourceObjects = sources.filter((s) => (device.assignedSources || []).includes(s.id));

          return (
            <div
              key={device.id}
              className={`border rounded-2xl p-4 transition-all duration-200 bg-white dark:bg-slate-900 ${
                isOnline
                  ? 'border-emerald-200 dark:border-emerald-900/40 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 opacity-80'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                      }`}
                    />
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">{device.name}</h3>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                    ID: {device.deviceId}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black ${
                      isOnline
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    {isOnline ? 'متصل' : 'غير متصل'}
                  </span>
                </div>
              </div>

              {/* Status details */}
              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span>الوجهة الافتراضية:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white text-[11px]">
                    {device.paymentDestination || '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span>حالة الانشغال:</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      device.busy
                        ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {device.busy ? 'مشغول بجلسة دفع' : 'متاح للاستقبال'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span>مستمع الإشعارات:</span>
                  <span
                    className={`text-[11px] font-bold ${
                      device.notificationListenerEnabled
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {device.notificationListenerEnabled ? 'مفعّل ونشط' : 'معطّل أو بحاجة إذن'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span>آخر نبضة (Heartbeat):</span>
                  <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
                    {device.lastHeartbeatAt ? new Date(device.lastHeartbeatAt).toLocaleTimeString('ar-EG') : '—'}
                  </span>
                </div>

                {/* Assigned sources pills */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">مصادر الدفع المرتبطة:</span>
                    <button
                      onClick={() => handleOpenSourceAssignment(device)}
                      className="text-[10px] text-cyan-600 dark:text-cyan-400 font-bold hover:underline flex items-center gap-1"
                    >
                      <Edit2 className="w-3 h-3" />
                      تعديل
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {assignedSourceObjects.map((src) => (
                      <span
                        key={src.id}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                      >
                        {src.displayName}
                      </span>
                    ))}
                    {assignedSourceObjects.length === 0 && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 italic">
                        لا توجد مصادر مخصصة (يعتمد على إعدادات التوافق الافتراضية)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Device Actions */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleToggleDevice(device)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${
                    device.isEnabled
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'
                  }`}
                >
                  {device.isEnabled ? 'تعطيل الجهاز' : 'تفعيل الجهاز'}
                </button>

                <button
                  onClick={() => handleReprovision(device)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-colors"
                  title="تدوير وتوليد مفتاح HMAC جديد"
                >
                  <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                  تدوير المفتاح
                </button>
              </div>
            </div>
          );
        })}

        {devices.length === 0 && (
          <div className="col-span-full text-center py-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
            <p className="text-xs text-slate-500 dark:text-slate-400">لا توجد أجهزة دفع مسجلة حالياً.</p>
          </div>
        )}
      </div>
    </div>
  );
};
