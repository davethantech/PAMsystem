/**
 * Keyrail PAM - Initial Setup Screen
 * 
 * This screen is shown when the system has not been initialized.
 * It allows the first administrator to create the first tenant and admin account.
 */
import { useState, useCallback } from 'react';
import { usePam } from '../state/store-new';
import { toastTone } from '../state/store-new';

export default function Setup() {
  const { initializeSystem, loading } = usePam();
  
  const [form, setForm] = useState({
    organizationName: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: '',
    tenantSlug: '',
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = useCallback(() => {
    const newErrors: Record<string, string> = {};
    
    if (!form.organizationName || form.organizationName.trim().length < 2) {
      newErrors.organizationName = 'Organization name is required (min 2 characters)';
    }
    
    if (!form.adminName || form.adminName.trim().length < 2) {
      newErrors.adminName = 'Administrator name is required (min 2 characters)';
    }
    
    if (!form.adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.adminEmail)) {
      newErrors.adminEmail = 'Valid administrator email is required';
    }
    
    if (!form.adminPassword || form.adminPassword.length < 12) {
      newErrors.adminPassword = 'Password must be at least 12 characters';
    }
    
    if (form.adminPassword !== form.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    
    if (!form.tenantSlug || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(form.tenantSlug)) {
      newErrors.tenantSlug = 'Tenant slug is required (lowercase alphanumeric and hyphens only)';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      await initializeSystem({
        organizationName: form.organizationName.trim(),
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim().toLowerCase(),
        adminPassword: form.adminPassword,
        tenantSlug: form.tenantSlug.trim(),
      });
    } catch (error) {
      // Error is handled by the store
    } finally {
      setIsSubmitting(false);
    }
  }, [form, validate, initializeSystem]);

  const handleChange = useCallback((field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  }, [errors]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-slate-700/50">
          <div className="text-center mb-8">
            <div className="text-4xl mb-4">🔐</div>
            <h1 className="text-2xl font-bold text-white">Keyrail PAM</h1>
            <p className="text-slate-400 mt-2">Initial Setup</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Organization Name
              </label>
              <input
                type="text"
                value={form.organizationName}
                onChange={(e) => handleChange('organizationName', e.target.value)}
                placeholder="Your Company Name"
                className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                  errors.organizationName ? 'border-red-500' : 'border-slate-600'
                } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
              {errors.organizationName && (
                <p className="mt-1 text-sm text-red-500">{errors.organizationName}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Administrator Name
              </label>
              <input
                type="text"
                value={form.adminName}
                onChange={(e) => handleChange('adminName', e.target.value)}
                placeholder="John Doe"
                className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                  errors.adminName ? 'border-red-500' : 'border-slate-600'
                } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
              {errors.adminName && (
                <p className="mt-1 text-sm text-red-500">{errors.adminName}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Administrator Email
              </label>
              <input
                type="email"
                value={form.adminEmail}
                onChange={(e) => handleChange('adminEmail', e.target.value)}
                placeholder="admin@yourcompany.com"
                className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                  errors.adminEmail ? 'border-red-500' : 'border-slate-600'
                } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
              {errors.adminEmail && (
                <p className="mt-1 text-sm text-red-500">{errors.adminEmail}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={form.adminPassword}
                onChange={(e) => handleChange('adminPassword', e.target.value)}
                placeholder="Minimum 12 characters"
                className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                  errors.adminPassword ? 'border-red-500' : 'border-slate-600'
                } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
              {errors.adminPassword && (
                <p className="mt-1 text-sm text-red-500">{errors.adminPassword}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
                placeholder="Confirm your password"
                className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                  errors.confirmPassword ? 'border-red-500' : 'border-slate-600'
                } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-500">{errors.confirmPassword}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Tenant Slug
                <span className="text-slate-500 text-xs ml-2">
                  (lowercase alphanumeric and hyphens only)
                </span>
              </label>
              <input
                type="text"
                value={form.tenantSlug}
                onChange={(e) => handleChange('tenantSlug', e.target.value)}
                placeholder="your-company"
                className={`w-full px-4 py-3 rounded-lg bg-slate-700/50 border ${
                  errors.tenantSlug ? 'border-red-500' : 'border-slate-600'
                } text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500`}
              />
              {errors.tenantSlug && (
                <p className="mt-1 text-sm text-red-500">{errors.tenantSlug}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || loading}
              className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-800 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
            >
              {isSubmitting || loading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Initializing...
                </>
              ) : (
                'Complete Setup'
              )}
            </button>
          </form>

          <div className="mt-8 p-4 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <h3 className="font-medium text-slate-300 mb-2">What happens next:</h3>
            <ul className="text-sm text-slate-400 space-y-1">
              <li>• Your organization tenant will be created</li>
              <li>• Your administrator account will be created</li>
              <li>• You will be automatically logged in</li>
              <li>• You can start adding users and credentials</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
