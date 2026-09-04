import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, {
  SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { LucideIcon, Pencil, Trash2 } from 'lucide-react-native';
import { AppTheme } from '../../theme';

const ACTION_WIDTH = 64;

export type { SwipeableMethods };

export type SwipeableGatewayRowAction = {
  key: string;
  backgroundColor: string;
  icon: LucideIcon;
  iconColor: string;
  onPress: () => void;
};

type Props = {
  colors: AppTheme['colors'];
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
  onRegisterRef?: (methods: SwipeableMethods | null) => void;
  onSwipeOpen?: () => void;
  extraActions?: SwipeableGatewayRowAction[];
};

function RightActions({
  progress,
  actions,
}: {
  progress: SharedValue<number>;
  actions: SwipeableGatewayRowAction[];
}): React.JSX.Element {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: (1 - progress.value) * ACTION_WIDTH * actions.length,
      },
    ],
  }));

  return (
    <Animated.View style={[styles.actionsContainer, animatedStyle]}>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <TouchableOpacity
            key={action.key}
            style={[styles.actionButton, { backgroundColor: action.backgroundColor }]}
            onPress={action.onPress}
            activeOpacity={0.7}
          >
            <Icon size={18} color={action.iconColor} strokeWidth={2} />
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
}

export function SwipeableGatewayRow({
  colors,
  onEdit,
  onDelete,
  children,
  onRegisterRef,
  onSwipeOpen,
  extraActions = [],
}: Props): React.JSX.Element {
  const swipeRef = useRef<SwipeableMethods>(null);

  useEffect(() => {
    onRegisterRef?.(swipeRef.current);
    return () => onRegisterRef?.(null);
  }, [onRegisterRef]);

  const handleEdit = useCallback(() => {
    swipeRef.current?.close();
    onEdit();
  }, [onEdit]);

  const handleDelete = useCallback(() => {
    swipeRef.current?.close();
    onDelete();
  }, [onDelete]);

  const resolvedExtraActions = extraActions.map((action) => ({
    ...action,
    onPress: () => {
      swipeRef.current?.close();
      action.onPress();
    },
  }));

  const actions: SwipeableGatewayRowAction[] = [
    ...resolvedExtraActions,
    {
      key: 'edit',
      backgroundColor: colors.primary,
      icon: Pencil,
      iconColor: colors.primaryText,
      onPress: handleEdit,
    },
    {
      key: 'delete',
      backgroundColor: colors.error,
      icon: Trash2,
      iconColor: colors.iconOnColor,
      onPress: handleDelete,
    },
  ];

  const renderRightActions = useCallback(
    (progress: SharedValue<number>) => (
      <RightActions progress={progress} actions={actions} />
    ),
    [actions],
  );

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
      onSwipeableOpen={onSwipeOpen}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actionsContainer: {
    flexDirection: 'row',
  },
  actionButton: {
    width: ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
