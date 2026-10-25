// Works around tauri-runtime-cef keeping the main thread at 100% of a core while idle on Linux
// (https://github.com/tauri-apps/tauri/issues/16189, fix proposed there, not merged yet).
//
// With CEF's external message pump, Chromium's GLib work source stays attached to the default
// context and asks for a zero timeout on every iteration, so the event loop never blocks. CEF's
// work reaches the runtime's own pump anyway, so that source can go. It's the one whose prepare
// lives in libcef, at G_PRIORITY_DEFAULT_IDLE, polling a single pipe. Drop this file once the
// runtime ships the fix.

use std::mem;

use glib_sys as ffi;

/// Must run on the main thread after CEF is initialized. Returns how many sources it removed.
pub fn destroy_chromium_work_source() -> usize {
    let Some(cef_base) = cef_base() else { return 0 };
    let mut destroyed = 0;
    unsafe {
        let context = ffi::g_main_context_default();
        // Source ids are handed out in order, so a fresh one bounds the search
        let probe = ffi::g_idle_source_new();
        let upper = ffi::g_source_attach(probe, context);
        ffi::g_source_destroy(probe);
        ffi::g_source_unref(probe);

        for id in 1..upper {
            let source = ffi::g_main_context_find_source_by_id(context, id);
            if source.is_null() || (*source).source_funcs.is_null() {
                continue;
            }
            let Some(prepare) = (*(*source).source_funcs).prepare else { continue };
            if module_base(prepare as *const libc::c_void) != Some(cef_base)
                || ffi::g_source_get_priority(source) != ffi::G_PRIORITY_DEFAULT_IDLE
            {
                continue;
            }
            let fds = (*source).poll_fds;
            if fds.is_null() || !(*fds).next.is_null() {
                continue;
            }
            let fd = (*((*fds).data as *const ffi::GPollFD)).fd;
            let mut st: libc::stat = mem::zeroed();
            if libc::fstat(fd, &mut st) != 0 || (st.st_mode & libc::S_IFMT) != libc::S_IFIFO {
                continue;
            }
            ffi::g_source_destroy(source);
            destroyed += 1;
        }
    }
    destroyed
}

fn cef_base() -> Option<*mut libc::c_void> {
    let sym = unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"cef_initialize".as_ptr()) };
    (!sym.is_null()).then(|| module_base(sym)).flatten()
}

fn module_base(addr: *const libc::c_void) -> Option<*mut libc::c_void> {
    let mut info: libc::Dl_info = unsafe { mem::zeroed() };
    (unsafe { libc::dladdr(addr, &mut info) } != 0).then_some(info.dli_fbase)
}
