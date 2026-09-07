Pod::Spec.new do |s|
  s.name           = 'CloudBackup'
  s.version        = '1.0.0'
  s.summary        = 'Zero-knowledge cloud backup of an opaque wallet blob (iOS CloudKit private database)'
  s.description    = 'Thin native bridge that stores a small opaque backup blob in the user\'s own iCloud CloudKit private database. Moves bytes only — never sees keys or seeds.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
