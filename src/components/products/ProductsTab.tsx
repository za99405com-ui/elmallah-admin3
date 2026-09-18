import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Product, ProductVariant, PricingUnit } from '../../types';
import { getSupabaseClient } from '../../lib/supabase';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  Scale,
  Hash,
  Upload,
  Image as ImageIcon,
  X,
  AlertTriangle,
  Sparkles,
  Fish,
  Layers,
} from 'lucide-react';

const SEAFOOD_SAMPLE_IMAGES = [
  { label: 'هامور بحري', url: 'https://images.unsplash.com/photo-1534483509719-3feaee7c30da?auto=format&fit=crop&w=800&q=80' },
  { label: 'دنيس طازج', url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=800&q=80' },
  { label: 'قاروص بحري', url: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=800&q=80' },
  { label: 'جمبري جامبو', url: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?auto=format&fit=crop&w=800&q=80' },
  { label: 'استاكوزا حية', url: 'https://images.unsplash.com/photo-1559742811-822873691df8?auto=format&fit=crop&w=800&q=80' },
  { label: 'كابوريا وسلطعون', url: 'https://images.unsplash.com/photo-1550950158-d0d960dff51b?auto=format&fit=crop&w=800&q=80' },
  { label: 'حبار وكلماري', url: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?auto=format&fit=crop&w=800&q=80' },
  { label: 'ناجل ملكي', url: 'https://images.unsplash.com/photo-1524704654690-b56c05c78a00?auto=format&fit=crop&w=800&q=80' },
];

export const ProductsTab: React.FC = () => {
  const { products, categories, addProduct, updateProduct, deleteProduct, addToast } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pricingUnit, setPricingUnit] = useState<PricingUnit>('kg');
  const [price, setPrice] = useState<number>(50);
  const [imageUrl, setImageUrl] = useState<string>(SEAFOOD_SAMPLE_IMAGES[0].url);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSavingProduct, setIsSavingProduct] = useState<boolean>(false);
  const [variants, setVariants] = useState<Array<{ id?: string; title: string; weightKg: number; pieceCount: number; price: number }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const openAddModal = () => {
    setEditingProduct(null);
    setName('');
    setDescription('');
    setCategoryId(categories[0]?.id || '');
    setPricingUnit('kg');
    setPrice(65);
    setImageUrl(SEAFOOD_SAMPLE_IMAGES[0].url);
    setVariants([]);
    setIsModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setName(product.name);
    setDescription(product.description);
    setCategoryId(product.categoryId);
    setPricingUnit(product.pricingUnit);
    setPrice(product.price);
    setImageUrl(product.imageUrl);
    setVariants(
      product.variants
        ? product.variants.map((v) => ({
            id: v.id,
            title: v.title,
            weightKg: v.weightKg,
            pieceCount: v.pieceCount,
            price: v.price,
          }))
        : []
    );
    setIsModalOpen(true);
  };

  const addVariantRow = () => {
    setVariants((prev) => [
      ...prev,
      {
        title: `حجم ${prev.length + 1} (${pricingUnit === 'kg' ? '1 كجم' : 'حبة'})`,
        weightKg: 1.0,
        pieceCount: 4,
        price: price || 70,
      },
    ]);
  };

  const updateVariantRow = (index: number, field: string, value: string | number) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  };

  const removeVariantRow = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const client = getSupabaseClient();
      if (client) {
        const fileExt = file.name.split('.').pop();
        const fileName = `product-${Date.now()}.${fileExt}`;
        const filePath = `products/${fileName}`;

        const { error: uploadError } = await client.storage
          .from('seafood-images')
          .upload(filePath, file, { upsert: true });

        if (!uploadError) {
          const { data } = client.storage.from('seafood-images').getPublicUrl(filePath);
          if (data?.publicUrl) {
            setImageUrl(data.publicUrl);
            addToast({
              type: 'success',
              title: 'تم رفع الصورة بنجاح',
              description: 'تم تحديث صورة الصنف بنجاح',
            });
            setIsUploading(false);
            return;
          }
        }
      }

      // Fallback
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageUrl(reader.result as string);
        setIsUploading(false);
        addToast({
          type: 'info',
          title: 'تم استخدام الصورة محلياً',
          description: 'تم تحميل الصورة للمعاينة الحالية',
        });
      };
      reader.readAsDataURL(file);
    } catch {
      setIsUploading(false);
      addToast({
        type: 'error',
        title: 'تعذر رفع الصورة',
        description: 'يرجى تجربة صورة أخرى أو استخدام رابط مباشر',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSavingProduct) return;

    const matchedCategory = categories.find((c) => c.id === categoryId);
    const categoryName = matchedCategory ? matchedCategory.name : 'عام';

    const formattedVariants = variants.map((v) => ({
      id: v.id,
      productId: editingProduct?.id || '',
      title: v.title,
      weightKg: Number(v.weightKg) || 1,
      pieceCount: Number(v.pieceCount) || 1,
      price: Number(v.price) || price,
    }));

    setIsSavingProduct(true);
    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, {
          name,
          description,
          categoryId,
          categoryName,
          pricingUnit,
          price,
          imageUrl,
          variants: formattedVariants,
        });
      } else {
        await addProduct({
          name,
          description,
          categoryId,
          categoryName,
          pricingUnit,
          price,
          imageUrl,
          isFreshOnly: true,
          variants: formattedVariants,
        });
      }

      // Close only after the server has durably accepted the product.
      setIsModalOpen(false);
    } catch {
      // AppContext already shows the server error toast.
      // Keep the form open so the entered product is not lost.
    } finally {
      setIsSavingProduct(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === 'all' || p.categoryId === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-4 pb-12">
      {/* Notice Banner */}
      <div className="p-3 sm:p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Fish className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
          <span className="text-cyan-700 dark:text-cyan-300 font-semibold">
            متجر أسماك الملاح يبيع حصرياً الأسماك الطازجة (نيئة بالوزن أو بالعدد) دون طهي - استلام طلبات مباشرة بدون مخزون مسبق.
          </span>
        </div>
        <span className="text-[10px] font-bold text-cyan-600 dark:text-cyan-400 hidden sm:inline">
          {products.length} صنف متاح للطلب
        </span>
      </div>

      {/* Top Search & Add Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="بحث عن سمك، جمبري، كابوريا..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-3 pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500 shadow-xs"
          />
        </div>

        <button
          onClick={openAddModal}
          className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة صنف</span>
        </button>
      </div>

      {/* Category selector chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-cyan-500 text-slate-950 shadow-xs'
              : 'bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          الكل ({products.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              selectedCategory === cat.id
                ? 'bg-cyan-500 text-slate-950 shadow-xs'
                : 'bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {cat.name} ({products.filter((p) => p.categoryId === cat.id).length})
          </button>
        ))}
      </div>

      {/* Products Table */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-[11px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-2.5 sm:p-3 pr-4">الصنف والصورة</th>
                <th className="p-2.5 sm:p-3">التصنيف</th>
                <th className="p-2.5 sm:p-3">التسعير</th>
                <th className="p-2.5 sm:p-3">السعر الأساسي</th>
                <th className="p-2.5 sm:p-3">الأحجام والخيارات</th>
                <th className="p-2.5 sm:p-3 pl-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-100 dark:divide-slate-800">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    لا توجد أصناف مطابقة للبحث
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                    {/* Image & Name */}
                    <td className="p-2.5 sm:p-3 pr-4 whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{product.name}</span>
                            {product.variants && product.variants.length > 0 && (
                              <span className="text-[9px] font-bold text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                                {product.variants.length} أحجام
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 line-clamp-1 max-w-xs mt-0.5">
                            {product.description}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                        {product.categoryName || 'عام'}
                      </span>
                    </td>

                    {/* Pricing Unit */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      {product.pricingUnit === 'kg' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md">
                          <Scale className="w-3 h-3" />
                          بالكيلو
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                          <Hash className="w-3 h-3" />
                          بالقطعة
                        </span>
                      )}
                    </td>

                    {/* Price */}
                    <td className="p-2.5 sm:p-3 whitespace-nowrap">
                      <div className="font-bold text-slate-900 dark:text-white text-xs">
                        {product.price} ج.م
                        <span className="text-[10px] font-normal text-slate-400 mr-1">
                          / {product.pricingUnit === 'kg' ? 'كجم' : 'قطعة'}
                        </span>
                      </div>
                    </td>

                    {/* Variants list */}
                    <td className="p-2.5 sm:p-3">
                      {product.variants && product.variants.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {product.variants.map((v) => (
                            <span
                              key={v.id || v.title}
                              className="text-[10px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700"
                            >
                              {v.title}: <strong className="text-cyan-600 dark:text-cyan-400">{v.price} ج.م</strong>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">حجم قياسي موحد</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="p-2.5 sm:p-3 pl-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEditModal(product)}
                          className="p-1 rounded-lg text-slate-400 hover:text-cyan-500 cursor-pointer"
                          title="تعديل"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteProduct(product.id)}
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

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold">
                {editingProduct ? 'تعديل الصنف' : 'إضافة صنف جديد'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">اسم الصنف *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: سمك دنيس بحري طازج"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">الوصف</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="صيد اليوم طازج وبارد..."
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">التصنيف</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">نوع التسعير</label>
                  <select
                    value={pricingUnit}
                    onChange={(e) => setPricingUnit(e.target.value as PricingUnit)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="kg">بالكيلوجرام (وزن)</option>
                    <option value="piece">بالقطعة (حبة)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">السعر الأساسي (ج.م) *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={price}
                    onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">طبيعة الصنف</label>
                  <div className="h-[34px] flex items-center px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 text-xs text-cyan-600 dark:text-cyan-400 font-medium">
                    طازج بحسب الطلب (دون مخزون)
                  </div>
                </div>
              </div>

              {/* Product Variants (الأحجام والخيارات) */}
              <div className="p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-600 dark:text-cyan-400">
                    <Layers className="w-4 h-4" />
                    <span>أحجام وخيارات الصنف (Product Variants)</span>
                  </div>
                  <button
                    type="button"
                    onClick={addVariantRow}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-600 dark:text-cyan-400 text-[10px] font-bold transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>إضافة حجم / خيار</span>
                  </button>
                </div>

                {variants.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center py-2">
                    لا توجد خيارات مخصصة لهذا الصنف (يتم الاعتماد على السعر الأساسي أعلاه). انقر على الزر لإضافة أحجام مثل (وسط 4-6 قطع/كجم، كبير جامبو 2 قطعة/كجم).
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-0.5">
                    {variants.map((v, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            placeholder="اسم الحجم / الخيار (مثال: حجم وسط 4-6 قطع)"
                            value={v.title}
                            onChange={(e) => updateVariantRow(idx, 'title', e.target.value)}
                            className="flex-1 px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => removeVariantRow(idx)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                            title="حذف هذا الخيار"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[10px]">
                          <div>
                            <span className="text-slate-400 block mb-0.5">الوزن التقديري (كجم)</span>
                            <input
                              type="number"
                              step="0.1"
                              value={v.weightKg}
                              onChange={(e) => updateVariantRow(idx, 'weightKg', parseFloat(e.target.value) || 0)}
                              className="w-full px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-center font-mono"
                            />
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-0.5">عدد القطع التقديري</span>
                            <input
                              type="number"
                              value={v.pieceCount}
                              onChange={(e) => updateVariantRow(idx, 'pieceCount', parseInt(e.target.value) || 0)}
                              className="w-full px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-center font-mono"
                            />
                          </div>
                          <div>
                            <span className="text-slate-400 block mb-0.5">السعر (ج.م)</span>
                            <input
                              type="number"
                              value={v.price}
                              onChange={(e) => updateVariantRow(idx, 'price', parseFloat(e.target.value) || 0)}
                              className="w-full px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-center font-mono text-cyan-600 dark:text-cyan-400 font-bold"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Image picker */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1">صورة الصنف</label>
                <div className="flex items-center gap-2 mb-2">
                  <img
                    src={imageUrl}
                    alt="معاينة"
                    className="w-12 h-12 rounded-xl object-cover border border-slate-300 dark:border-slate-700"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex-1">
                    <input
                      type="text"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="رابط الصورة..."
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
                {/* Preset quick images */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {SEAFOOD_SAMPLE_IMAGES.map((img, i) => (
                    <button
                      type="button"
                      key={i}
                      onClick={() => setImageUrl(img.url)}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold whitespace-nowrap cursor-pointer ${
                        imageUrl === img.url
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {img.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSavingProduct}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSavingProduct || isUploading}
                  className="px-4 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingProduct
                    ? 'جاري الحفظ...'
                    : editingProduct
                      ? 'حفظ التعديلات'
                      : 'إضافة الصنف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
