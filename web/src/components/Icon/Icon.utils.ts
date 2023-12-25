import * as SVG from '@/assets';

export const ICON_NAME_MAP: Record<
  string,
  React.ElementType<React.ComponentPropsWithRef<'svg'>>
> = {
  add: SVG.Add,
  addOn: SVG.AddOn,
  bell: SVG.Bell,
  bellOn: SVG.BellOn,
  chat: SVG.Chat,
  chatOn: SVG.ChatOn,
  gear: SVG.Gear,
  gearOn: SVG.GearOn,
  home: SVG.Home,
  homeOn: SVG.HomeOn,
};
