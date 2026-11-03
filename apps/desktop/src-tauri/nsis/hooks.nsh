; Windows caches shortcut icons and keeps the old one after an update.
; SHCNE_ASSOCCHANGED (0x08000000) makes Explorer reload them.
!macro NSIS_HOOK_POSTINSTALL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
