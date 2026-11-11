import fs from 'node:fs';
import path from 'node:path';
import {parseXmlTree, type ManifestNode} from './apk.ts';

type RoleFilter = {
  action: string;
  scheme?: string;
  mimeType?: string;
  defaultCategory?: boolean;
};
type RoleComponent = {
  name: string;
  tag: 'activity' | 'service' | 'receiver' | 'provider';
  exported: boolean;
  permission?: string;
  filters?: readonly RoleFilter[];
};

// The pinned PermissionController qualifies DIALER and SMS against these intent
// handlers. Include their private call UI and MMS components for the actual role traffic.
const roleComponents: readonly RoleComponent[] = [
  {name: 'AlphaInCallService', tag: 'service', exported: true,
    permission: 'android.permission.BIND_INCALL_SERVICE',
    filters: [{action: 'android.telecom.InCallService'}]},
  {name: 'AlphaCallActivity', tag: 'activity', exported: false},
  {name: 'AlphaDialPadActivity', tag: 'activity', exported: true, filters: [
    {action: 'android.intent.action.DIAL', defaultCategory: true},
    {action: 'android.intent.action.DIAL', scheme: 'tel', defaultCategory: true},
  ]},
  {name: 'AlphaSmsDeliverReceiver', tag: 'receiver', exported: true,
    permission: 'android.permission.BROADCAST_SMS',
    filters: [{action: 'android.provider.Telephony.SMS_DELIVER'}]},
  {name: 'AlphaMmsWapPushReceiver', tag: 'receiver', exported: true,
    permission: 'android.permission.BROADCAST_WAP_PUSH',
    filters: [{action: 'android.provider.Telephony.WAP_PUSH_DELIVER', mimeType: 'application/vnd.wap.mms-message'}]},
  {name: 'AlphaMmsResultReceiver', tag: 'receiver', exported: false},
  {name: 'AlphaRespondViaMessageService', tag: 'service', exported: true,
    permission: 'android.permission.SEND_RESPOND_VIA_MESSAGE',
    filters: [{action: 'android.intent.action.RESPOND_VIA_MESSAGE', scheme: 'smsto', defaultCategory: true}]},
  {name: 'AlphaSmsComposeActivity', tag: 'activity', exported: true,
    filters: [{action: 'android.intent.action.SENDTO', scheme: 'smsto', defaultCategory: true}]},
  {name: 'ai.eliza.plugins.messages.MmsFileProvider', tag: 'provider', exported: false},
];

const isTrue = (value: string | undefined) => value === 'true' || value === '0xffffffff';
const isFalse = (value: string | undefined) => value === 'false' || value === '0x0';

function matchesFilter(filter: ManifestNode, required: RoleFilter) {
  if (filter.name !== 'intent-filter') return false;
  const has = (tag: string, attribute: string, value: string) =>
    filter.children.some(child => child.name === tag && child.attrs[attribute] === value);
  const data = filter.children.filter(child => child.name === 'data');
  // Android qualifies roles with generic intents, without host or path selectors.
  const uriRestricted = filter.children.some(child => child.name === 'uri-relative-filter-group')
    || data.some(child => Object.keys(child.attrs).some(attribute => attribute !== 'scheme' && attribute !== 'mimeType'));
  return !uriRestricted && has('action', 'name', required.action)
    && (!required.defaultCategory || has('category', 'name', 'android.intent.category.DEFAULT'))
    && (required.scheme ? has('data', 'scheme', required.scheme) : data.every(child => !child.attrs.scheme))
    && (required.mimeType ? has('data', 'mimeType', required.mimeType) : data.every(child => !child.attrs.mimeType));
}

/** Read the privately staged release APK's manifest before making the roles eligible at boot. */
export function aospTelephonyRoleComponents(xmltree: string, packageName: string) {
  const manifest = parseXmlTree(xmltree).children.find(node => node.name === 'manifest');
  const application = manifest?.children.find(node => node.name === 'application');
  if (manifest?.attrs.package !== packageName || !application ||
      !/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(packageName))
    throw Error('Alpha telephony roles require the staged launcher package manifest');
  const qualify = (name: string) => {
    if (name.startsWith('.')) return packageName + name;
    return name.includes('.') ? name : `${packageName}.${name}`;
  };
  return roleComponents.map(required => {
    const name = qualify(required.name);
    const candidates = application.children.filter(node => node.attrs.name && qualify(node.attrs.name) === name);
    const node = candidates[0];
    if (candidates.length !== 1 || node.name !== required.tag || !isFalse(node.attrs.enabled)
        || !(required.exported ? isTrue(node.attrs.exported) : isFalse(node.attrs.exported))
        || node.attrs.permission !== required.permission)
      throw Error(`Alpha telephony roles require exactly one disabled ${required.tag} with the expected protection: ${name}`);
    if (required.filters?.some(filter => !node.children.some(child => matchesFilter(child, filter))))
      throw Error(`Alpha telephony role intent filters are incomplete: ${name}`);
    if (node.name === 'provider' &&
        (node.attrs.authorities !== `${packageName}.mms` || !isTrue(node.attrs.grantUriPermissions)))
      throw Error(`Alpha telephony roles require ${name} to grant URI access for ${packageName}.mms`);
    if (required.name === 'AlphaInCallService') {
      const metadata = node.children.filter(child => child.name === 'meta-data');
      if (!metadata.some(child => child.attrs.name === 'android.telecom.IN_CALL_SERVICE_UI' && isTrue(child.attrs.value))
          || metadata.some(child => child.attrs.name === 'android.telecom.IN_CALL_SERVICE_CAR_MODE_UI' && isTrue(child.attrs.value)))
        throw Error('Alpha telephony roles require the dialer InCallService UI');
    }
    return name;
  });
}

export function writeAospTelephonyRoles(output: string, xmltree: string, packageName: string) {
  const names = aospTelephonyRoleComponents(xmltree, packageName);
  const name = 'alpha-telephony-components.xml';
  const components = names.map(component => `        <component class="${component}" enabled="true" />`).join('\n');
  // Provision uses this versioned feature to distinguish production role setup
  // from the HOME-only path on branded development images.
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<config>
    <feature name="${packageName}.feature.INITIAL_TELEPHONY_ROLES" version="1" />
    <component-override package="${packageName}">
${components}
    </component-override>
</config>
`;
  fs.writeFileSync(path.join(output, 'provisioning', name), xml, {flag: 'wx'});
  fs.appendFileSync(path.join(output, 'product.mk'),
    `\nPRODUCT_COPY_FILES += $(launcher_provisioning_dir)/${name}:$(TARGET_COPY_OUT_SYSTEM_EXT)/etc/sysconfig/${name}\n`);
}
