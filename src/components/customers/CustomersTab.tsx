import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Customer } from '../../types';
import {
  Users,
  UserPlus,
  Search,
  Phone,
  Mail,
  MapPin,
  ShoppingBag,
  MessageCircle,
  Download,
  CheckCircle2,
  XCircle,
  Edit2,
  Trash2,
  Eye,
  X,
  Sparkles,
  Smartphone,
  Globe,
} from 'lucide-react';

export const CustomersTab: React.FC = () => {
  const { customers, orders, addCustomer, updateCustomer, deleteCustomer, toggleCustomerStatus } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    city: 'القاهرة',
    district: '',
    address: '',
    registrationSource: 'web' as 'web' | 'mobile',
    notes: '',
  });

  // Calculate stats
  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((c) => c.status === 'active').length;
  const vipCustomers = customers.filter((c) => c.totalSpent >= 1000).length;
  const totalCustomerSpending = customers.reduce((sum, c) => sum + c.totalSpent, 0);

  // Filter customers
  const filteredCustomers = customers.filter((customer) => {
    const matchesSearch =
      customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.phone.includes(searchQuery) ||
      customer.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.district.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.city.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      selectedStatus === 'all' || customer.status === selectedStatus;

    const matchesSource =
      selectedSource === 'all' || customer.registrationSource === selectedSource;

    return matchesSearch && matchesStatus && matchesSource;
  });

  const handleOpenAddModal = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      city: 'القاهرة',
      district: '',
      address: '',
      registrationSource: 'web',
      notes: '',
    });
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      city: customer.city,
      district: customer.district,
      address: customer.address,
      registrationSource: customer.registrationSource,
      notes: customer.notes || '',
    });
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.phone.trim()) return;

    addCustomer({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      city: formData.city,
      district: formData.district,
      address: formData.address,
      registrationSource: formData.registrationSource,
      notes: formData.notes,
      totalOrders: 0,
      totalSpent: 0,
      status: 'active',
    });

    setIsAddModalOpen(false);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;

    updateCustomer(editingCustomer.id, {
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      city: formData.city,
      district: formData.district,
      address: formData.address,
      registrationSource: formData.registrationSource,
      notes: formData.notes,
    });

    setEditingCustomer(null);
  };

  const handleExportCSV = () => {
    const headers = 'الاسم,البريد الإلكتروني,رقم الهاتف,المدينة,الحي,العنوان,المصدر,الطلبات,الإنفاق,الحالة\n';
    const rows = filteredCustomers
      .map(
        (c) =>
          `"${c.name}","${c.email}","${c.phone}","${c.city}","${c.district}","${c.address}","${
            c.registrationSource === 'web' ? 'الموقع' : 'الجوال'
          }",${c.totalOrders},${c.totalSpent},"${c.status === 'active' ? 'نشط' : 'محظور'}"`
      )
      .join('\n');

    const blob = new Blob(['\uFEFF' + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `customers_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 pb-12">
      {/* 4 Summary Cards - Compact 2x2 on mobile */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Total Customers */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">إجمالي العملاء</span>
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 text-cyan-500 flex items-center justify-center">
              <Users className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">{totalCustomers}</span>
            <span className="text-[10px] text-slate-400">مسجل</span>
          </div>
        </div>

        {/* Active Customers */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">العملاء النشطين</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-emerald-500">{activeCustomers}</span>
            <span className="text-[10px] text-slate-400">نشط</span>
          </div>
        </div>

        {/* VIP Customers */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">عملاء VIP</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-amber-500">{vipCustomers}</span>
            <span className="text-[10px] text-slate-400">+1000 ج.م</span>
          </div>
        </div>

        {/* Total Spending */}
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-3 sm:p-4 rounded-xl shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">مشتريات العملاء</span>
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <ShoppingBag className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">
              {totalCustomerSpending.toLocaleString('ar-EG')}
            </span>
            <span className="text-[10px] text-slate-400">ج.م</span>
          </div>
        </div>
      </div>

      {/* Filter and Actions Bar */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-2.5 sm:p-3.5 rounded-xl shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 transition-colors">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث بالاسم، الهاتف، أو المدينة..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-3 pr-9 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Filter and Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="blocked">محظور</option>
          </select>

          <button
            onClick={handleExportCSV}
            title="تصدير CSV"
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>إضافة عميل</span>
          </button>
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-2.5 sm:p-3 pr-4">العميل</th>
                <th className="p-2.5 sm:p-3">الهاتف والواتساب</th>
                <th className="p-2.5 sm:p-3">المدينة والحي</th>
                <th className="p-2.5 sm:p-3">الطلبات والمشتريات</th>
                <th className="p-2.5 sm:p-3">الحالة</th>
                <th className="p-2.5 sm:p-3 pl-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    لم يتم العثور على أي عملاء
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    {/* Name */}
                    <td className="p-2.5 sm:p-3 pr-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 font-bold flex items-center justify-center shrink-0 text-xs">
                          {customer.name.slice(0, 1)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{customer.name}</span>
                            {customer.totalSpent >= 1000 && (
                              <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/15 text-amber-500">
                                VIP
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {customer.registrationSource === 'web' ? 'موقع' : 'جوال'}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Phone & WhatsApp */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-700 dark:text-slate-300 dir-ltr">{customer.phone}</span>
                        <a
                          href={`https://wa.me/20${customer.phone.replace(/^0+/, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          title="واتساب"
                          className="p-1 rounded-md bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </td>

                    {/* City */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <span className="text-slate-800 dark:text-slate-200 font-medium">{customer.city}</span>
                      {customer.district && (
                        <span className="text-slate-400 text-[10px] block">{customer.district}</span>
                      )}
                    </td>

                    {/* Orders & Spent */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <span className="font-bold text-slate-900 dark:text-white">{customer.totalSpent} ج.م</span>
                      <span className="text-slate-400 text-[10px] block">({customer.totalOrders} طلب)</span>
                    </td>

                    {/* Status */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <button
                        onClick={() => toggleCustomerStatus(customer.id)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer ${
                          customer.status === 'active'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : 'bg-rose-500/15 text-rose-500'
                        }`}
                      >
                        {customer.status === 'active' ? 'نشط' : 'محظور'}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="p-2.5 sm:p-3 pl-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setViewingCustomer(customer)}
                          className="p-1 rounded-lg text-slate-400 hover:text-cyan-500 cursor-pointer"
                          title="عرض"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(customer)}
                          className="p-1 rounded-lg text-slate-400 hover:text-blue-500 cursor-pointer"
                          title="تعديل"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteCustomer(customer.id)}
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Details Modal */}
      {viewingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold">{viewingCustomer.name}</h3>
              <button
                onClick={() => setViewingCustomer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                <span className="text-slate-400 block mb-0.5">الهاتف</span>
                <span className="font-bold dir-ltr block text-right">{viewingCustomer.phone}</span>
              </div>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                <span className="text-slate-400 block mb-0.5">البريد</span>
                <span className="font-medium truncate block">{viewingCustomer.email || 'غير مسجل'}</span>
              </div>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl col-span-2">
                <span className="text-slate-400 block mb-0.5">العنوان</span>
                <span className="font-medium">{viewingCustomer.city} {viewingCustomer.district ? `- ${viewingCustomer.district}` : ''}: {viewingCustomer.address}</span>
              </div>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                <span className="text-slate-400 block mb-0.5">عدد الطلبات</span>
                <span className="font-bold text-cyan-600 dark:text-cyan-400">{viewingCustomer.totalOrders}</span>
              </div>
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                <span className="text-slate-400 block mb-0.5">إجمالي المشتريات</span>
                <span className="font-bold text-emerald-500">{viewingCustomer.totalSpent} ج.م</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => {
                  setViewingCustomer(null);
                  handleOpenEditModal(viewingCustomer);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                تعديل البيانات
              </button>
              <button
                onClick={() => setViewingCustomer(null)}
                className="px-4 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Customer Modal */}
      {(isAddModalOpen || editingCustomer) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-4 sm:p-6 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold">
                {editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              </h3>
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setEditingCustomer(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={editingCustomer ? handleEditSubmit : handleAddSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">الاسم الكامل *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">رقم الهاتف *</label>
                  <input
                    type="text"
                    required
                    placeholder="01012345678"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 dir-ltr text-right"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">المدينة</label>
                  <select
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="القاهرة">القاهرة</option>
                    <option value="الجيزة">الجيزة</option>
                    <option value="الإسكندرية">الإسكندرية</option>
                    <option value="السويس">السويس</option>
                    <option value="بورسعيد">بورسعيد</option>
                    <option value="الإسماعيلية">الإسماعيلية</option>
                    <option value="الغردقة">الغردقة</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">عنوان التوصيل بالتفصيل</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="الشارع، رقم العمارة، الشقة..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setEditingCustomer(null);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400"
                >
                  حفظ العميل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
