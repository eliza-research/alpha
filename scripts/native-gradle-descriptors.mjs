/** Native patch admission permits existing src/main/java targets only and verifies every other byte.
 * Therefore dependency/repository/license scanners must read the unchanged pinned Gradle descriptors
 * for staged modules, using the same canonical path identity as before staging was introduced. */
export function canonicalNativeGradleSettings(settings) {
 return settings.replace(/new File\(nativePatchSource\.root,\s*'(plugins\/plugin-native-[a-z-]+\/android(?:-nativeonly)?)'\)/g,(_all,module)=>`new File('../vendor/eliza/${module}')`);
}
